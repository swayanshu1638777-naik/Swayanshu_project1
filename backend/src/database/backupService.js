const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const { getDatabase } = require('./index');

const backupFilenamePattern = /^college_portal-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.sqlite$/;

function getBackupConfig(env = process.env) {
  const required = ['S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
  for (const key of required) {
    if (typeof env[key] !== 'string' || !env[key].trim() || env[key].startsWith('CHANGE_ME')) {
      throw new Error(`${key} must be configured with a non-placeholder value`);
    }
  }
  let endpoint;
  try {
    endpoint = new URL(env.S3_ENDPOINT);
  } catch (error) {
    throw new Error('S3_ENDPOINT must be a valid HTTPS endpoint');
  }
  if (endpoint.protocol !== 'https:') throw new Error('S3_ENDPOINT must use HTTPS');

  const intervalHours = Number(env.BACKUP_INTERVAL_HOURS || 24);
  const retentionDays = Number(env.BACKUP_RETENTION_DAYS || 30);
  if (!Number.isInteger(intervalHours) || intervalHours < 1 || intervalHours > 720) {
    throw new Error('BACKUP_INTERVAL_HOURS must be an integer between 1 and 720');
  }
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
    throw new Error('BACKUP_RETENTION_DAYS must be an integer between 1 and 3650');
  }

  const configuredDirectory = env.DATABASE_BACKUP_DIR || './data/backups';
  return {
    endpoint: endpoint.toString(),
    region: env.S3_REGION,
    bucket: env.S3_BUCKET,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    prefix: (env.S3_PREFIX || 'college-portal').replace(/^\/+|\/+$/g, ''),
    backupDirectory: path.isAbsolute(configuredDirectory)
      ? configuredDirectory
      : path.resolve(__dirname, '..', '..', configuredDirectory),
    intervalMs: intervalHours * 60 * 60 * 1000,
    retentionMs: retentionDays * 24 * 60 * 60 * 1000,
  };
}

function createS3Client(config) {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

async function removeExpiredLocalBackups(directory, cutoff) {
  await fs.mkdir(directory, { recursive: true });
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !backupFilenamePattern.test(entry.name)) continue;
    const filename = path.join(directory, entry.name);
    const details = await fs.stat(filename);
    if (details.mtimeMs < cutoff) await fs.rm(filename);
  }
}

async function removeExpiredRemoteBackups(client, config, cutoff) {
  let continuationToken;
  do {
    const page = await client.send(new ListObjectsV2Command({
      Bucket: config.bucket,
      Prefix: config.prefix ? `${config.prefix}/` : undefined,
      ContinuationToken: continuationToken,
    }));
    const expired = (page.Contents || []).filter((object) => {
      const expectedPrefix = config.prefix ? `${config.prefix}/` : '';
      if (!object.Key || !object.Key.startsWith(expectedPrefix)
          || !backupFilenamePattern.test(path.posix.basename(object.Key))) return false;
      return object.LastModified && object.LastModified.getTime() < cutoff;
    });
    for (let index = 0; index < expired.length; index += 1000) {
      const result = await client.send(new DeleteObjectsCommand({
        Bucket: config.bucket,
        Delete: { Objects: expired.slice(index, index + 1000).map(({ Key }) => ({ Key })) },
      }));
      if (result.Errors?.length) {
        const error = new Error('S3 reported failures deleting expired backups');
        error.name = 'BackupRetentionError';
        throw error;
      }
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
}

async function createAndUploadBackup({
  config,
  client,
  databaseFactory = getDatabase,
  uploader = Upload,
  now = new Date(),
}) {
  await fs.mkdir(config.backupDirectory, { recursive: true });
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  const filename = `college_portal-${timestamp}.sqlite`;
  const backupPath = path.join(config.backupDirectory, filename);
  const db = databaseFactory();
  try {
    await db.backup(backupPath);
  } finally {
    db.close();
  }

  const key = [config.prefix, filename].filter(Boolean).join('/');
  const cutoff = Date.now() - config.retentionMs;
  try {
    await new uploader({
      client,
      params: {
        Bucket: config.bucket,
        Key: key,
        Body: createReadStream(backupPath),
        ContentType: 'application/vnd.sqlite3',
      },
    }).done();
  } finally {
    await removeExpiredLocalBackups(config.backupDirectory, cutoff);
  }
  await removeExpiredRemoteBackups(client, config, cutoff);
  return backupPath;
}

function startBackupScheduler(env = process.env) {
  const config = getBackupConfig(env);
  const client = createS3Client(config);
  let currentRun;
  let stopping = false;

  const run = () => {
    if (currentRun || stopping) return currentRun;
    currentRun = createAndUploadBackup({ config, client })
      .then((filename) => console.info(`Database backup uploaded: ${path.basename(filename)}`))
      .catch((error) => console.error('Scheduled database backup failed:', error.name || 'Error'))
      .finally(() => { currentRun = undefined; });
    return currentRun;
  };

  void run();
  const timer = setInterval(run, config.intervalMs);
  const shutdown = async () => {
    stopping = true;
    clearInterval(timer);
    if (currentRun) await currentRun;
    client.destroy();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (require.main === module) {
  try {
    startBackupScheduler();
  } catch (error) {
    console.error('Database backup service configuration failed:', error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  createAndUploadBackup,
  getBackupConfig,
  removeExpiredLocalBackups,
  removeExpiredRemoteBackups,
};
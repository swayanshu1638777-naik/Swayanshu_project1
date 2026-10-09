const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createDatabase } = require('../src/database');
const {
  createAndUploadBackup,
  getBackupConfig,
  removeExpiredLocalBackups,
  removeExpiredRemoteBackups,
} = require('../src/database/backupService');

const validBackupEnv = {
  S3_ENDPOINT: 'https://s3.us-west-004.backblazeb2.com',
  S3_REGION: 'us-west-004',
  S3_BUCKET: 'college-portal-backups',
  S3_ACCESS_KEY_ID: 'test-access-key',
  S3_SECRET_ACCESS_KEY: 'test-secret-key',
  DATABASE_BACKUP_DIR: '/tmp/college-portal-backups',
};

test('backup configuration requires HTTPS S3 and valid schedule/retention values', () => {
  const config = getBackupConfig(validBackupEnv);
  assert.equal(config.region, 'us-west-004');
  assert.equal(config.bucket, 'college-portal-backups');
  assert.equal(config.intervalMs, 24 * 60 * 60 * 1000);
  assert.equal(config.retentionMs, 30 * 24 * 60 * 60 * 1000);
  assert.throws(() => getBackupConfig({ ...validBackupEnv, S3_ENDPOINT: 'http://storage.local' }), /HTTPS/);
  assert.throws(() => getBackupConfig({ ...validBackupEnv, S3_SECRET_ACCESS_KEY: '' }), /S3_SECRET_ACCESS_KEY/);
  assert.throws(() => getBackupConfig({ ...validBackupEnv, S3_BUCKET: 'CHANGE_ME_bucket' }), /S3_BUCKET/);
  assert.throws(() => getBackupConfig({ ...validBackupEnv, BACKUP_RETENTION_DAYS: '0' }), /BACKUP_RETENTION_DAYS/);
});

test('local retention only removes expired portal backups', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'portal-backup-retention-'));
  const oldBackup = path.join(directory, 'college_portal-2020-01-01T00-00-00-000Z.sqlite');
  const keepBackup = path.join(directory, 'college_portal-2020-01-02T00-00-00-000Z.sqlite');
  const unrelated = path.join(directory, 'keep-this.txt');
  try {
    await Promise.all([oldBackup, keepBackup, unrelated].map((filename) => fs.writeFile(filename, 'data')));
    const cutoff = Date.now() - 60_000;
    await fs.utimes(oldBackup, new Date(cutoff - 60_000), new Date(cutoff - 60_000));
    await fs.utimes(keepBackup, new Date(), new Date());
    await removeExpiredLocalBackups(directory, cutoff);
    await assert.rejects(fs.access(oldBackup));
    await fs.access(keepBackup);
    await fs.access(unrelated);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('remote retention deletes only expired SQLite backups under the configured prefix', async () => {
  const deleted = [];
  const client = {
    async send(command) {
      if (command.constructor.name === 'ListObjectsV2Command') {
        return {
          Contents: [
            { Key: 'college-portal/college_portal-2020-01-01T00-00-00-000Z.sqlite', LastModified: new Date(0) },
            { Key: 'college-portal/college_portal-2020-01-02T00-00-00-000Z.sqlite', LastModified: new Date() },
            { Key: 'college-portal/other.txt', LastModified: new Date(0) },
            { Key: 'other-prefix/college_portal-2020-01-01T00-00-00-000Z.sqlite', LastModified: new Date(0) },
          ],
          IsTruncated: false,
        };
      }
      deleted.push(...command.input.Delete.Objects.map(({ Key }) => Key));
      return {};
    },
  };
  await removeExpiredRemoteBackups(client, {
    bucket: 'college-portal-backups',
    prefix: 'college-portal',
  }, Date.now() - 60_000);
  assert.deepEqual(deleted, ['college-portal/college_portal-2020-01-01T00-00-00-000Z.sqlite']);
});

test('remote retention reports S3 per-object deletion failures', async () => {
  const client = {
    async send(command) {
      if (command.constructor.name === 'ListObjectsV2Command') {
        return {
          Contents: [{
            Key: 'college-portal/college_portal-2020-01-01T00-00-00-000Z.sqlite',
            LastModified: new Date(0),
          }],
          IsTruncated: false,
        };
      }
      return { Errors: [{ Code: 'AccessDenied' }] };
    },
  };
  await assert.rejects(removeExpiredRemoteBackups(client, {
    bucket: 'college-portal-backups',
    prefix: 'college-portal',
  }, Date.now() - 60_000), {
    name: 'BackupRetentionError',
    message: 'S3 reported failures deleting expired backups',
  });
});

test('backup worker creates a consistent SQLite file and uploads it to S3', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'portal-backup-upload-'));
  const config = getBackupConfig({ ...validBackupEnv, DATABASE_BACKUP_DIR: directory });
  const uploaded = [];
  const client = { async send() { return { Contents: [], IsTruncated: false }; } };
  class FakeUploader {
    constructor({ params }) { this.params = params; }
    async done() {
      const chunks = [];
      for await (const chunk of this.params.Body) chunks.push(chunk);
      uploaded.push({ ...this.params, Body: Buffer.concat(chunks) });
    }
  };
  try {
    const filename = await createAndUploadBackup({
      config,
      client,
      uploader: FakeUploader,
      databaseFactory: () => createDatabase(':memory:'),
      now: new Date('2026-01-02T03:04:05.006Z'),
    });
    const db = createDatabase(filename);
    try {
      assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
    } finally {
      db.close();
    }
    assert.equal(uploaded.length, 1);
    assert.equal(uploaded[0].Key, 'college-portal/college_portal-2026-01-02T03-04-05-006Z.sqlite');
    assert.equal(uploaded[0].Bucket, 'college-portal-backups');
    assert.ok(uploaded[0].Body.length > 0);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('local retention still runs when the off-host upload fails', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'portal-backup-failure-'));
  const config = getBackupConfig({ ...validBackupEnv, DATABASE_BACKUP_DIR: directory, BACKUP_RETENTION_DAYS: '1' });
  const expiredBackup = path.join(directory, 'college_portal-2020-01-01T00-00-00-000Z.sqlite');
  await fs.writeFile(expiredBackup, 'old backup');
  await fs.utimes(expiredBackup, new Date(0), new Date(0));
  try {
    await assert.rejects(createAndUploadBackup({
      config,
      client: { async send() { return { Contents: [], IsTruncated: false }; } },
      uploader: class FailedUploader { async done() { throw new Error('upload failed'); } },
      databaseFactory: () => createDatabase(':memory:'),
      now: new Date('2026-01-02T03:04:05.006Z'),
    }), /upload failed/);
    await assert.rejects(fs.access(expiredBackup));
    await fs.access(path.join(directory, 'college_portal-2026-01-02T03-04-05-006Z.sqlite'));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
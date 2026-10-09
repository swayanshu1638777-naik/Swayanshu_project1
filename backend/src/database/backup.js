require('dotenv').config({ path: require('node:path').resolve(__dirname, '..', '..', '.env') });
const fs = require('node:fs');
const path = require('node:path');
const { getDatabase } = require('./index');

const backupDirectory = path.resolve(__dirname, '..', '..', process.env.DATABASE_BACKUP_DIR || './data/backups');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupFile = path.join(backupDirectory, `college_portal-${timestamp}.sqlite`);
const db = getDatabase();

fs.mkdirSync(backupDirectory, { recursive: true });
db.backup(backupFile)
  .then(() => {
    console.info(`Database backup created: ${backupFile}`);
  })
  .catch((error) => {
    console.error('Database backup failed:', error);
    process.exitCode = 1;
  })
  .finally(() => db.close());

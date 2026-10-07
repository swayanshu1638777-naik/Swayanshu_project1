require('dotenv').config();
const { createApp } = require('./app');
const { getDatabase } = require('./database');
const {
  assertNoDemoSeedAccounts,
  validateProductionRuntimeConfig,
} = require('./utils/productionConfig');
const path = require('node:path');

if (process.env.NODE_ENV === 'production') validateProductionRuntimeConfig(process.env);

const port = Number(process.env.PORT) || 5000;
const db = getDatabase();
if (process.env.NODE_ENV === 'production') {
  try {
    assertNoDemoSeedAccounts(db);
  } catch (error) {
    db.close();
    throw error;
  }
}
const app = createApp({
  db,
  ...(process.env.NODE_ENV === 'production'
    ? { publicDir: path.resolve(__dirname, '..', 'public') }
    : {}),
});
const server = app.listen(port, () => console.info(`Smart College API listening on port ${port}`));

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

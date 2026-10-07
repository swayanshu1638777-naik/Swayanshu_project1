const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createApp } = require('../src/app');
const { createDatabase } = require('../src/database');

test('configured production public directory serves the portal without exposing dotfiles', async () => {
  const publicDir = await fs.mkdtemp(path.join(os.tmpdir(), 'smart-college-public-'));
  const db = createDatabase(':memory:');
  let server;
  try {
    await fs.writeFile(path.join(publicDir, 'index.html'), '<h1>Portal</h1>');
    await fs.writeFile(path.join(publicDir, '.env'), 'secret=value');
    server = createApp({ db, publicDir }).listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const home = await fetch(baseUrl);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /Portal/);
    const secret = await fetch(`${baseUrl}/.env`);
    assert.equal(secret.status, 404);
  } finally {
    if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    db.close();
    await fs.rm(publicDir, { recursive: true, force: true });
  }
});

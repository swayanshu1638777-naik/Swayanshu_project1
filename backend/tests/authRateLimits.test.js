const assert = require('node:assert/strict');
const express = require('express');
const { after, before, test } = require('node:test');
const { createAuthRateLimits } = require('../src/middleware/requestLimits');

const app = express();
app.set('trust proxy', 1);
const limits = createAuthRateLimits({ loginWindowMs: 60_000, loginLimit: 2 });
app.post('/login', limits.login, (req, res) => res.sendStatus(204));
let server;
let baseUrl;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
}));

test('login rate limits use the client IP passed through one trusted proxy hop', async () => {
  const request = (ip) => fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'x-forwarded-for': ip },
  });
  assert.equal((await request('198.51.100.20')).status, 204);
  assert.equal((await request('198.51.100.20')).status, 204);
  assert.equal((await request('198.51.100.20')).status, 429);
  assert.equal((await request('198.51.100.21')).status, 204);
});
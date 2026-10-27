const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const portalRoot = path.resolve(__dirname, '..', '..');
const pages = new Set(fs.readdirSync(portalRoot).filter((name) => name.endsWith('.html')));
const configuredPort = process.env.FRONTEND_PORT;
const port = configuredPort == null || configuredPort === '' ? 5501 : Number(configuredPort);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
  throw new Error('FRONTEND_PORT must be an integer between 1 and 65535');
}

const app = express();
app.disable('x-powered-by');
app.get('/', (req, res) => res.sendFile(path.join(portalRoot, 'index.html')));
app.get('/:page', (req, res, next) => {
  if (!pages.has(req.params.page)) return next();
  return res.sendFile(path.join(portalRoot, req.params.page));
});
for (const directory of ['css', 'js', 'assets']) {
  app.use(`/${directory}`, express.static(path.join(portalRoot, directory), { dotfiles: 'deny' }));
}
app.use((req, res) => res.status(404).type('text').send('Not found'));

app.listen(port, '127.0.0.1', () => {
  console.info(`Smart College Portal frontend listening on http://127.0.0.1:${port}`);
});

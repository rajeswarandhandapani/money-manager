// Small local web server for trying the app. Usage: npm start
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 4174;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const PUBLIC = /^\/(index\.html|styles\.css|manifest\.webmanifest|sw\.js|js\/[\w-]+\.js|icons\/[\w-]+\.png)$/;

function start(port = PORT) {
  const server = http.createServer((req, res) => {
    let url = decodeURIComponent(req.url.split('?')[0]);
    if (url === '/') url = '/index.html';
    if (!PUBLIC.test(url)) { res.writeHead(404); res.end('Not found'); return; }
    fs.readFile(path.join(ROOT, url), (err, body) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(url)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(body);
    });
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (require.main === module) start().then(() => console.log(`Money Manager: http://localhost:${PORT}`));
module.exports = { start };

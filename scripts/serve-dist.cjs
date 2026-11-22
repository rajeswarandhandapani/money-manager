// Local static server for built Angular dist/ output (used by Playwright browser tests).
const http = require('http');
const fs = require('fs');
const path = require('path');

const DIST_ROOT = path.resolve(__dirname, '..', 'dist', 'money-manager', 'browser');
const PORT = Number(process.env.PORT) || 4182;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
};

function start(port = PORT) {
  const server = http.createServer((req, res) => {
    let urlPath = '/';
    try {
      urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    } catch {
      res.writeHead(400);
      res.end('Bad request');
      return;
    }
    if (urlPath === '/') urlPath = '/index.html';

    const rel = urlPath.replace(/^\/+/, '');
    const candidate = path.resolve(DIST_ROOT, rel);
    if (!candidate.startsWith(DIST_ROOT + path.sep) && candidate !== path.join(DIST_ROOT, 'index.html')) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    const serveFile = target => {
      fs.readFile(target, (err, body) => {
        if (err) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        res.writeHead(200, {
          'Content-Type': TYPES[path.extname(target)] || 'application/octet-stream',
          'Cache-Control': 'no-cache',
        });
        res.end(body);
      });
    };

    fs.stat(candidate, (err, st) => {
      if (!err && st.isFile()) {
        serveFile(candidate);
      } else if (!path.extname(candidate)) {
        serveFile(path.join(DIST_ROOT, 'index.html'));
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });
  });

  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (require.main === module) {
  start().then(() => console.log(`Money Manager dist server: http://127.0.0.1:${PORT}`));
}

module.exports = { start, DIST_ROOT };

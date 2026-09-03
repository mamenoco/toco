// dist/ をローカルで配信して見た目を確認するための簡易サーバー
const http = require('http');
const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};

function start(port) {
  return http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const full = path.join(DIST, p);
  if (!full.startsWith(DIST) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    const nf = path.join(DIST, '404.html');
    res.writeHead(404, { 'Content-Type': MIME['.html'] });
    res.end(fs.existsSync(nf) ? fs.readFileSync(nf) : 'Not Found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
  res.end(fs.readFileSync(full));
  }).listen(port, "127.0.0.1");
}

module.exports = { start };

if (require.main === module) {
  const p = Number(process.argv[2] || 4569);
  start(p);
  console.log(`http://localhost:${p}/ で dist/ を配信中`);
}

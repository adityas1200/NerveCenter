// Serves the built frontend (Vite's dist) and nothing else: the UI half of the combined image.
//
// The UI Deployment runs this instead of nginx when a build job cannot pick --target frontend
// (see the last stage of the Dockerfile). It must not start the backend: the ticket poller and
// the routine scheduler would run a second time against the same database and S3 workspace.
//
// The platform gateway sends /nervecenter/api/* straight to the API Service, so /api never
// arrives here; if it does, that is a routing mistake and it is reported rather than served
// index.html. Paths arrive with or without PUBLIC_BASE_PATH, as deploy/nginx.conf allows.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff', ...headers });
  res.end(JSON.stringify(body));
}

export function createUiServer({ root, basePath = '' }) {
  const dir = path.resolve(root);
  const base = String(basePath || '').replace(/\/+$/, '');
  const inside = file => file === dir || file.startsWith(dir + path.sep);
  const isFile = file => { try { return fs.statSync(file).isFile(); } catch { return false; } };

  return http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' }, { allow: 'GET, HEAD' });
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { return send(res, 400, { error: 'Bad request' }); }

    if (pathname === '/health' || pathname === `${base}/health`) return send(res, 200, { ok: true, role: 'ui' });
    if (base && (pathname === base || pathname.startsWith(`${base}/`))) pathname = pathname.slice(base.length) || '/';
    if (pathname === '/api' || pathname.startsWith('/api/') || pathname.startsWith('/apps/api/')) {
      return send(res, 404, { error: 'The API is served by the API service, not the UI service' });
    }

    let file = path.join(dir, pathname);
    if (!inside(path.resolve(file))) return send(res, 404, { error: 'Not found' });
    if (isFile(path.join(file, 'index.html'))) file = path.join(file, 'index.html');
    // Client-side routes fall back to the app shell; a missing asset (a path with an extension) is a real 404.
    if (!isFile(file)) {
      if (path.extname(pathname)) return send(res, 404, { error: 'Not found' });
      file = path.join(dir, 'index.html');
      if (!isFile(file)) return send(res, 404, { error: 'The frontend build is missing from this image' });
    }

    const immutable = pathname.startsWith('/assets/') && file !== path.join(dir, 'index.html');
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  });
}

import fs from 'node:fs/promises';
import path from 'node:path';

// Serves the built frontend when the backend is the only process (a Databricks App). Unknown paths
// fall back to index.html so client-side routes load; Vite's hashed /assets/ files cache forever.

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json', '.webmanifest': 'application/manifest+json' };

export async function serveStatic(req, res, url, root) {
  let relative;
  try { relative = decodeURIComponent(url.pathname); } catch { relative = '/'; }
  let file = path.resolve(root, `.${relative}`);
  if (file !== root && !file.startsWith(root + path.sep)) file = path.join(root, 'index.html');
  let stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile()) { file = path.join(root, 'index.html'); stat = await fs.stat(file).catch(() => null); }
  if (!stat?.isFile()) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Frontend build not found'); return; }
  const hashed = relative.startsWith('/assets/');
  res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'content-length': stat.size, 'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache' });
  if (req.method === 'HEAD') { res.end(); return; }
  res.end(await fs.readFile(file));
}

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createUiServer } from '../src/ui/ui-server.mjs';

// The UI Deployment runs this server from the combined image, behind a gateway that rewrites
// /nervecenter/ to / (and may or may not keep the prefix).

const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'nc-ui-'));
const root = path.join(parent, 'dist');
await fs.mkdir(path.join(root, 'assets'), { recursive: true });
await fs.writeFile(path.join(root, 'index.html'), '<!doctype html><title>NerveCenter</title>');
await fs.writeFile(path.join(root, 'assets', 'app-1a2b3c.js'), 'console.log("app")');
await fs.writeFile(path.join(parent, 'secret.txt'), 'outside the dist directory');

const server = createUiServer({ root, basePath: '/nervecenter' });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
test.after(async () => { server.close(); await fs.rm(parent, { recursive: true, force: true }); });

const get = async (url, options) => { const res = await fetch(`http://127.0.0.1:${port}${url}`, options); return { res, body: await res.text() }; };
// fetch() normalises ../ away, so traversal has to be sent as a raw request line.
const raw = requestPath => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path: requestPath }, res => { let body = ''; res.on('data', chunk => { body += chunk; }); res.on('end', () => resolve({ status: res.statusCode, body })); }).on('error', reject);
});

test('the app shell is served with or without the base path', async () => {
  for (const url of ['/', '/nervecenter', '/nervecenter/', '/index.html', '/nervecenter/index.html']) {
    const { res, body } = await get(url);
    assert.equal(res.status, 200, url);
    assert.match(res.headers.get('content-type'), /^text\/html/, url);
    assert.equal(res.headers.get('cache-control'), 'no-cache', url);
    assert.match(body, /NerveCenter/, url);
  }
});

test('hashed assets are served with the right type and cached for a year', async () => {
  for (const url of ['/assets/app-1a2b3c.js', '/nervecenter/assets/app-1a2b3c.js']) {
    const { res, body } = await get(url);
    assert.equal(res.status, 200, url);
    assert.match(res.headers.get('content-type'), /^text\/javascript/);
    assert.match(res.headers.get('cache-control'), /immutable/);
    assert.equal(body, 'console.log("app")');
  }
});

test('client-side routes get the app shell, but a missing asset is a 404', async () => {
  const route = await get('/nervecenter/tickets/OPS-1');
  assert.equal(route.res.status, 200);
  assert.match(route.body, /NerveCenter/);
  assert.equal((await get('/nervecenter/assets/missing.js')).res.status, 404);
});

test('/api is never answered with the app shell', async () => {
  for (const url of ['/api/me', '/nervecenter/api/me', '/apps/api/v1/auth/session']) {
    const { res, body } = await get(url);
    assert.equal(res.status, 404, url);
    assert.match(body, /API service/, url);
  }
});

test('health answers on both paths and says which role it is', async () => {
  for (const url of ['/health', '/nervecenter/health']) assert.deepEqual(JSON.parse((await get(url)).body), { ok: true, role: 'ui' });
});

test('nothing outside the dist directory can be read', async () => {
  for (const requestPath of ['/../secret.txt', '/nervecenter/../secret.txt', '/%2e%2e/secret.txt', '/assets/..%2f..%2fsecret.txt']) {
    const { status, body } = await raw(requestPath);
    assert.ok(!body.includes('outside the dist directory'), requestPath);
    assert.ok([200, 404].includes(status), `${requestPath} -> ${status}`);
  }
});

test('only GET and HEAD are allowed, and HEAD has no body', async () => {
  const post = await get('/', { method: 'POST' });
  assert.equal(post.res.status, 405);
  const head = await get('/', { method: 'HEAD' });
  assert.equal(head.res.status, 200);
  assert.equal(head.body, '');
});

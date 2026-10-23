import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createBackend } from '../src/bootstrap.mjs';
import { createApiServer } from '../src/api/server.mjs';
import { linkable, route } from '../src/lib/router.mjs';

// SPEC-projects-01 FR-50: links, iframes and images cannot send the project header, so the raw task file route takes `?project=`.
let backend; let server; let base;
const get = async (route, { user = 'alice', header } = {}) => {
  const headers = { 'x-user-id': user, 'x-user-name': user };
  if (header) headers['x-nervecenter-project'] = header;
  const response = await fetch(`${base}${route}`, { headers });
  return { status: response.status, text: await response.text() };
};
const raw = (project, file = 'report.md') => `/api/tasks/T-link/files/raw?path=${file}${project === undefined ? '' : `&project=${project}`}`;

test.before(async () => {
  backend = await createBackend();
  for (const [project, name] of [['alpha', 'Alpha'], ['beta', 'Beta']]) await backend.projectStore.create({ id: project, name }, { id: 'test' });
  await backend.projectStore.addMember('alpha', 'alice', { id: 'test' });
  await backend.projectStore.addMember('beta', 'bob', { id: 'test' });
  await backend.taskStore.createTask({ id: 'T-link', type: 'adhoc', status: 'done', projectId: 'alpha', createdBy: { id: 'alice' }, createdAt: new Date().toISOString() });
  const dir = await (await backend.runtime.workspaces.for('alpha')).taskDir('T-link');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'report.md'), '# Report\n');
  server = createApiServer(backend);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => new Promise(resolve => server.close(resolve)));

test('FR-50: a member opens a raw task file with ?project= and no header', async () => {
  const opened = await get(raw('alpha'));
  assert.equal(opened.status, 200);
  assert.equal(opened.text, '# Report\n');
});

test('FR-50: ?project= is resolved like the header: missing, unknown, malformed or not a member is 403', async () => {
  const missing = await get(raw(undefined));
  assert.equal(missing.status, 403); assert.match(missing.text, /Project required/);
  assert.equal((await get(raw('nonesuch'))).status, 403);
  assert.equal((await get(raw('..%2Fx'))).status, 403);
  assert.equal((await get(raw('alpha'), { user: 'bob' })).status, 403, 'bob is not in alpha');
  assert.equal((await get(raw('beta'), { user: 'bob' })).status, 403, 'the task is not in beta');
});

test('FR-50: the header wins over ?project=', async () => {
  assert.equal((await get(raw('alpha'), { header: 'beta' })).status, 403);
  assert.equal((await get(raw('beta'), { header: 'alpha' })).status, 200);
});

test('FR-50: other task file routes still need the header', async () => {
  assert.equal((await get('/api/tasks/T-link/files/content?path=report.md&project=alpha')).status, 403);
  assert.equal((await get('/api/tasks/T-link/files?project=alpha')).status, 403);
  assert.equal((await get('/api/tasks/T-link/files/content?path=report.md', { header: 'alpha' })).status, 200);
});

test('FR-50: only a GET route can be linkable', () => {
  assert.throws(() => linkable(route('POST', '/api/x', () => ({}))), /Only a GET route/);
  assert.equal(linkable(route('GET', '/api/x', () => ({}))).linkable, true);
});

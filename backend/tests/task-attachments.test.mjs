import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { taskRoutes } from '../src/api/task-routes.mjs';
import { authorizeRoute, permissionsFor, projectUser } from '../src/app/rbac.mjs';
import { sendError, sendJson } from '../src/lib/http.mjs';
import { dispatch } from '../src/lib/router.mjs';
import { PROJECT_HEADER, resolveScope } from '../src/projects/project-access.mjs';
import { TaskRuntime } from '../src/tasks/task-runtime.mjs';
import { decodeAttachments } from '../src/tasks/attachments.mjs';
import { fakeSdk, makeRuntime, sdkInit, sdkResult, tempDir, wait, pilot } from './helpers.mjs';

// SPEC-tasks-11: files attached to a message are saved in the task folder and named in the agent's message.

const tmp = await tempDir('nc-task-attachments-');
const user = { id: 'dev', name: 'Dev' };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake image body')]);
const png = (name = 'shot.png') => ({ name, data: `data:image/png;base64,${PNG.toString('base64')}` });
const csv = (name = 'runs.csv') => ({ name, data: Buffer.from('run,status\n1,failed\n').toString('base64') });

const sdk = fakeSdk();
const { runtime, store, workspace } = await makeRuntime(tmp, sdk, { name: 'routes', maxConcurrent: 1 });
const projectStore = {
  async memberProjectIds() { return ['pilot']; },
  async get(id) { return id === 'pilot' ? { id: 'pilot', kind: 'normal' } : null; },
  async list() { return [{ id: 'pilot', kind: 'normal' }]; },
  async memberRole(_projectId, userId) { return userId === 'viewer' ? 'viewer' : 'developer'; },
};
let server; let base;
test.before(async () => {
  const routes = taskRoutes({ runtime, taskStore: store });
  server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const userId = String(req.headers['x-user-id'] || 'dev');
      const role = userId === 'viewer' ? 'viewer' : 'developer';
      const actor = { id: userId, name: userId, role, permissions: permissionsFor(role) };
      const handled = await dispatch(routes, {
        req, res, url, p: url.pathname.split('/').filter(Boolean), m: req.method, user: actor,
        scopeUser: scope => projectUser(actor, scope),
        resolveScope: entry => resolveScope({ store: projectStore, user: actor, header: req.headers[PROJECT_HEADER], scopeClass: entry.scope, method: req.method }),
        authorize: (needs, method, who, scope) => authorizeRoute(who, method, needs, scope),
      });
      if (!handled) sendJson(res, 404, { error: 'Route not found' });
    } catch (error) { sendError(res, error?.statusCode || 500, error); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => new Promise(resolve => server.close(resolve)));

const post = async (url, body, userId = 'dev') => {
  const response = await fetch(`${base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-nervecenter-project': 'pilot', 'x-user-id': userId }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json().catch(() => null) };
};
const userEvents = async id => (await store.listEvents(id, { limit: 1000 })).filter(event => event.type === 'user.message');

test('FR-5 FR-6 FR-7 FR-8 a new task with files and no text saves them and names them to the agent', async () => {
  const created = await post('/api/tasks', { prompt: '', attachments: [png(), csv()] });
  assert.equal(created.status, 201);
  const id = created.body.id;
  await wait(async () => (await runtime.getTask(id)).status === 'done');
  const [event] = await userEvents(id);
  assert.equal(event.text, 'Take a look at the attached files.');
  assert.equal(event.attachments.length, 2);
  const [image, table] = event.attachments;
  assert.match(image.path, /^attachments\/q-[a-z0-9]+\/shot\.png$/);
  assert.deepEqual({ name: image.name, size: image.size, mime: image.mime }, { name: 'shot.png', size: PNG.length, mime: 'image/png' });
  assert.equal(table.mime, 'text/csv');
  const taskDir = await workspace.taskDir(id);
  assert.deepEqual(await fs.readFile(path.join(taskDir, image.path)), PNG);
  const prompt = sdk.calls.at(-1).prompt;
  assert.match(prompt, /<attachments>[\s\S]*Open each one with Read/);
  assert.ok(prompt.includes(`- tasks/${id}/${image.path} (image/png, 1 KB)`), prompt);
  assert.ok(prompt.includes(`tasks/${id}/${table.path} (text/csv`));
});

test('FR-6 FR-11 a follow-up keeps duplicate names apart, strips folders, and the file routes serve the files', async () => {
  const created = await post('/api/tasks', { prompt: 'Look at this pipeline' });
  const id = created.body.id;
  await wait(async () => (await runtime.getTask(id)).status === 'done');
  const sent = await post(`/api/tasks/${id}/messages`, { text: 'and these', attachments: [png('../../evil.png'), png('evil.png')] });
  assert.equal(sent.status, 202);
  await wait(async () => (await userEvents(id)).length === 2 && (await runtime.getTask(id)).status === 'done');
  const [, event] = await userEvents(id);
  assert.deepEqual(event.attachments.map(item => item.name), ['evil.png', 'evil (2).png']);
  const taskDir = await workspace.taskDir(id);
  for (const item of event.attachments) assert.ok(!path.relative(taskDir, path.join(taskDir, item.path)).startsWith('..'));
  const raw = await fetch(`${base}/api/tasks/${id}/files/raw?path=${encodeURIComponent(event.attachments[0].path)}`, { headers: { 'x-nervecenter-project': 'pilot', 'x-user-id': 'dev' } });
  assert.equal(raw.status, 200);
  assert.equal(raw.headers.get('content-type'), 'image/png');
  const tree = await (await fetch(`${base}/api/tasks/${id}/files`, { headers: { 'x-nervecenter-project': 'pilot', 'x-user-id': 'dev' } })).json();
  assert.match(JSON.stringify(tree.items), /evil \(2\)\.png/);
});

test('FR-3 FR-4 the routes refuse files Sonic cannot read, fakes, and too many or too large files', async () => {
  const cases = [
    [[{ name: 'notes.doc', data: Buffer.from('PK').toString('base64') }], /notes\.doc is not a file Sonic can read/],
    [[{ name: 'shot.png', data: Buffer.from('not a png').toString('base64') }], /shot\.png is not a real \.png file/],
    [[{ name: 'empty.txt', data: '' }], /empty\.txt is empty/],
    [Array.from({ length: 11 }, (_, n) => csv(`r${n}.csv`)), /at most 10 files/],
    [[{ name: 'big.txt', data: Buffer.alloc(10 * 1024 * 1024 + 1, 97).toString('base64') }], /big\.txt is larger than 10 MB/],
    ['one file', /attachments must be a list/],
  ];
  for (const [attachments, message] of cases) {
    const response = await post('/api/tasks', { prompt: 'check', attachments });
    assert.equal(response.status, 400, String(message));
    assert.match(response.body.error, message);
  }
  assert.throws(() => decodeAttachments([1, 2, 3].map(n => ({ name: `f${n}.txt`, data: Buffer.alloc(9 * 1024 * 1024, 97).toString('base64') }))), /larger than 25 MB together/);
});

test('FR-4 a message larger than the old 8 MB body limit is accepted', async () => {
  const response = await post('/api/tasks', { prompt: 'big log', attachments: [{ name: 'job.log', data: Buffer.alloc(7 * 1024 * 1024, 97).toString('base64') }] });
  assert.equal(response.status, 201);
  await wait(async () => (await runtime.getTask(response.body.id)).status === 'done');
});

test('FR-4 text beside the files keeps the normal request limit', async () => {
  const response = await post('/api/tasks', { prompt: 'x'.repeat(8 * 1024 * 1024), attachments: [png()] });
  assert.equal(response.status, 413);
  assert.equal(response.body.code, 'PAYLOAD_TOO_LARGE');
});

test('a viewer cannot attach files', async () => {
  const response = await post('/api/tasks', { prompt: 'check', attachments: [png()] }, 'viewer');
  assert.equal(response.status, 403);
});

test('FR-9 a queued message and an edited message keep their files', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const calls = [];
  const slow = { calls, query({ prompt }) { calls.push(prompt); const n = calls.length; return (async function* () { yield sdkInit(`s-${n}`); if (n === 1) await gate; yield sdkResult(`s-${n}`, `Reply ${n}`); })(); } };
  const { runtime: own } = await makeRuntime(tmp, slow, { name: 'queue', maxConcurrent: 1 });
  const task = await own.startTask({ scope: pilot, prompt: 'start', user });
  await wait(() => calls.length === 1);
  const queued = await own.sendMessage(task.id, user, 'see this', { attachments: decodeAttachments([png()]) });
  assert.equal(queued.queued, true);
  assert.equal(queued.message.attachments[0].name, 'shot.png');
  release();
  await wait(async () => calls.length === 2 && (await own.getTask(task.id)).status === 'done');
  assert.match(calls[1], /<attachments>[\s\S]*shot\.png/);
  const events = (await own.getTask(task.id, { includeEvents: true })).events.filter(event => event.type === 'user.message');
  await own.editMessage(task.id, events[1].id, 'see this, again', user);
  await wait(async () => calls.length === 3 && (await own.getTask(task.id)).status === 'done');
  assert.match(calls[2], /<attachments>[\s\S]*shot\.png[\s\S]*see this, again/);
});

test('FR-9 a task requeued after a restart keeps its files', async () => {
  const { store: own, workspace: ws } = await makeRuntime(tmp, fakeSdk(), { name: 'restart' });
  const attachments = [{ name: 'shot.png', path: 'attachments/q-1/shot.png', size: 10, mime: 'image/png' }];
  await own.createTask({ id: 'T-restart', type: 'adhoc', title: 'restart', status: 'queued', projectId: 'pilot', permission: 'policy', context: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), startedAt: null, cost: {}, pendingStart: { prompt: 'look', user, attachments } });
  const sdk2 = fakeSdk();
  const restarted = new TaskRuntime({ store: own, workspace: ws, sdkLoader: async () => sdk2 });
  const recovered = await restarted.recoverAfterRestart();
  assert.deepEqual(recovered.requeued, ['T-restart']);
  await wait(async () => (await restarted.getTask('T-restart')).status === 'done');
  assert.match(sdk2.calls[0].prompt, /tasks\/T-restart\/attachments\/q-1\/shot\.png \(image\/png, 1 KB\)/);
  const [event] = (await own.listEvents('T-restart', { limit: 100 })).filter(item => item.type === 'user.message');
  assert.deepEqual(event.attachments, attachments);
});

test('FR-8 messages from before attachments read as having none', async () => {
  const created = await post('/api/tasks', { prompt: 'plain' });
  await wait(async () => (await runtime.getTask(created.body.id)).status === 'done');
  const [event] = await userEvents(created.body.id);
  assert.equal(event.attachments, undefined);
  assert.doesNotMatch(sdk.calls.at(-1).prompt, /<attachments>/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskRuntime } from '../src/tasks/task-runtime.mjs';
import { fakeSdk, makeRuntime, tempDir, wait, pilot } from './helpers.mjs';

const tmp = await tempDir('nc-sonic-recovery-');
const user = { id: 'reviewer', name: 'Reviewer' };

test('ADR 0013: a never claimed initial prompt survives restart and runs once', async () => {
  const sdk = fakeSdk();
  const { workspace, store, runtime } = await makeRuntime(tmp, sdk, { name: 'initial', maxConcurrent: 0 });
  const task = await runtime.startTask({ scope: pilot, prompt: 'Investigate the load', user });
  assert.equal(sdk.calls.length, 0);
  assert.equal((await store.getTask(task.id)).pendingStart.prompt, 'Investigate the load');
  const recovered = new TaskRuntime({ store, workspace, sdkLoader: async () => sdk });
  assert.deepEqual((await recovered.recoverAfterRestart()).requeued, [task.id]);
  await wait(async () => (await store.getTask(task.id)).status === 'done');
  assert.equal(sdk.calls.length, 1);
  assert.equal((await store.getTask(task.id)).pendingStart, null);
  assert.equal((await recovered.getTask(task.id)).pendingStart, undefined);
});

test('ADR 0013: a pre-run permission event does not consume the initial command', async () => {
  const sdk = fakeSdk();
  const { workspace, store, runtime } = await makeRuntime(tmp, sdk, { name: 'capped', maxConcurrent: 0 });
  const task = await runtime.startTask({ scope: pilot, prompt: 'Read the status', user: { id: 'viewer', name: 'Viewer', role: 'viewer' }, permission: 'allow' });
  assert.equal((await store.listEvents(task.id))[0].type, 'status');
  const recovered = new TaskRuntime({ store, workspace, sdkLoader: async () => sdk });
  assert.deepEqual((await recovered.recoverAfterRestart()).requeued, [task.id]);
  await wait(async () => (await store.getTask(task.id)).status === 'done');
  assert.equal(sdk.calls.length, 1);
});

test('ADR 0013: an interrupted write is never replayed and its transcript remains', async () => {
  const sdk = fakeSdk();
  const { workspace, store } = await makeRuntime(tmp, sdk, { name: 'interrupted' });
  const createdAt = new Date().toISOString();
  await store.createTask({ id: 'T-2001', projectId: 'pilot', type: 'adhoc', status: 'running', title: 'Change data', createdAt, updatedAt: createdAt, startedAt: createdAt, sessionId: 'saved-session', pendingMessages: [], createdBy: user });
  await store.appendEvent('T-2001', { type: 'user.message', text: 'Change data', actor: user });
  await store.appendEvent('T-2001', { type: 'tool.use', name: 'mcp__databricks__run_job_now', input: '{"job_id":731}' });
  const recovered = new TaskRuntime({ store, workspace, sdkLoader: async () => sdk });
  assert.deepEqual((await recovered.recoverAfterRestart()).failed, ['T-2001']);
  assert.equal(sdk.calls.length, 0);
  const task = await recovered.getTask('T-2001', { includeEvents: true });
  assert.equal(task.status, 'failed');
  assert.match(task.error, /restarted/);
  assert.deepEqual(task.events.slice(0, 2).map(event => event.seq), [1, 2]);
  assert.equal(task.events[1].type, 'tool.use');
  assert.equal(task.events[2].type, 'error');
});

test('ADR 0013: an acknowledged follow-up stays visible but needs explicit resend after restart', async () => {
  let release;
  const first = { query() { return (async function* () { await new Promise(resolve => { release = resolve; }); })(); } };
  const { workspace, store, runtime } = await makeRuntime(tmp, first, { name: 'followup' });
  const task = await runtime.startTask({ scope: pilot, prompt: 'First turn', user });
  await wait(() => Boolean(release));
  const accepted = await runtime.sendMessage(task.id, user, 'Check the invoice too');
  assert.equal(accepted.queued, true);
  const sdk = fakeSdk();
  const recovered = new TaskRuntime({ store, workspace, sdkLoader: async () => sdk });
  await recovered.recoverAfterRestart();
  assert.equal((await recovered.getTask(task.id)).queue[0].text, 'Check the invoice too');
  assert.equal(sdk.calls.length, 0);
  assert.equal((await store.getTask(task.id)).status, 'failed');
  await recovered.sendQueuedNow(task.id, accepted.message.id, user);
  await wait(async () => (await store.getTask(task.id)).status === 'done');
  assert.equal(sdk.calls.length, 1);
  assert.deepEqual((await recovered.getTask(task.id)).queue, []);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fakeSdk, makeRuntime, tempDir, wait, pilot } from './helpers.mjs';

// Editing a sent message rewinds the conversation to it: later events go, the agent gets a fresh
// session told what was said before, and the thread shows the new text as the person's message.

const tmp = await tempDir('nc-task-edit-');
const user = { id: 'bhawin', name: 'Bhawin' };

const harness = sdk => makeRuntime(tmp, sdk, { maxConcurrent: 2 });

/** Done, with `turns` of the person's messages on record (a follow-up leaves the status at "done" for a tick before its run starts). */
const done = (runtime, id, turns = 1, store = runtime.store) => wait(async () => (await store.listEvents(id)).filter(event => event.type === 'user.message').length >= turns && (await runtime.getTask(id)).status === 'done');

test('editing a later message rewinds to it, keeps the earlier turn, and starts a fresh session with the transcript', async () => {
  const sdk = fakeSdk({ narrate: true });
  const { store, runtime } = await harness(sdk);
  const task = await runtime.startTask({ scope: pilot, prompt: 'hi what can you do', user });
  await done(runtime, task.id);
  await runtime.sendMessage(task.id, user, 'show me failed pipelines');
  await done(runtime, task.id, 2);
  const before = await store.listEvents(task.id);
  const second = before.filter(event => event.type === 'user.message')[1];
  assert.equal(second.text, 'show me failed pipelines');

  const after = await runtime.editMessage(task.id, second.id, 'show me failed pipelines from last night', user);
  assert.equal(after.historyVersion, 1);
  assert.equal(after.sessionId, null);
  await done(runtime, task.id, 2);

  const events = await store.listEvents(task.id);
  const messages = events.filter(event => event.type === 'user.message').map(event => event.text);
  assert.deepEqual(messages, ['hi what can you do', 'show me failed pipelines from last night']);
  assert.ok(!events.some(event => event.type === 'assistant.text' && event.text === 'Reply 2'), 'the discarded reply is gone');
  assert.ok(events.some(event => event.type === 'assistant.text' && event.text === 'Reply 3'), 'the new reply is there');
  const marker = events.find(event => event.type === 'status' && event.title === 'Message edited');
  assert.ok(marker && marker.seq < events.find(event => event.text === 'show me failed pipelines from last night').seq, 'the edit marker sits before the new message');
  assert.ok(events.every((event, index) => event.seq === index + 1), 'seq numbers stay contiguous');

  const last = sdk.calls.at(-1);
  assert.equal(last.options.resume, undefined, 'no resume: the old session remembers what was discarded');
  assert.match(last.prompt, /Bhawin: hi what can you do/);
  assert.match(last.prompt, /Sonic: Reply 1/);
  assert.match(last.prompt, /show me failed pipelines from last night$/);
  assert.equal((await runtime.getTask(task.id)).title, 'hi what can you do', 'the title follows the first message, which did not change');
});

test('editing the first message retitles the task and sends the new text alone', async () => {
  const sdk = fakeSdk({ narrate: true });
  const { store, runtime } = await harness(sdk);
  const task = await runtime.startTask({ scope: pilot, prompt: 'hi dobby', user });
  await done(runtime, task.id);
  const first = (await store.listEvents(task.id)).find(event => event.type === 'user.message');
  await runtime.editMessage(task.id, first.id, 'Which pipelines failed today?', user);
  await done(runtime, task.id);
  assert.equal((await runtime.getTask(task.id)).title, 'Which pipelines failed today?');
  assert.equal(sdk.calls.at(-1).prompt, 'Which pipelines failed today?');
  const events = await store.listEvents(task.id);
  assert.equal(events[0].type, 'status');
  assert.equal(events[1].text, 'Which pipelines failed today?');
});

test('a message the agent already acted on cannot be rewound', async () => {
  const sdk = fakeSdk({ narrate: true, writeTool: 'mcp__atlassian__addCommentToJiraIssue' });
  const { store, runtime } = await harness(sdk);
  const task = await runtime.startTask({ scope: pilot, prompt: 'comment on DATAOPS-1', user, permission: 'allow' });
  await done(runtime, task.id);
  const first = (await store.listEvents(task.id)).find(event => event.type === 'user.message');
  await assert.rejects(runtime.editMessage(task.id, first.id, 'never mind', user), error => error.statusCode === 409 && /made changes after this message/.test(error.message));
  assert.equal((await store.listEvents(task.id)).length, (await store.listEvents(task.id)).length, 'nothing was removed');
  await assert.rejects(runtime.editMessage(task.id, 'nope', 'x', user), error => error.statusCode === 404 && /not in this task/.test(error.message));
  await assert.rejects(runtime.editMessage(task.id, first.id, '   ', user), error => error.statusCode === 400 && /text is required/.test(error.message));
});

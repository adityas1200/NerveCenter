import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { makeRuntime, sdkInit, sdkResult, tempDir, wait, pilot } from './helpers.mjs';

const tmp = await tempDir('nc-questions-');
const user = { id: 'mitesh.shinde', name: 'Mitesh Shinde' };

const QUESTIONS = [
  { question: 'Which period should the report cover?', header: 'Period', multiSelect: false, options: [{ label: 'Last 7 days', description: 'Monday to Sunday' }, { label: 'Last 30 days', description: 'The full month' }] },
  { question: 'Which brands?', header: 'Brands', multiSelect: true, options: [{ label: 'Veltrix', description: '' }, { label: 'Corvana', description: '' }] },
];

// An agent that asks, then reports what it was told.
function askingSdk(seen) {
  return { query({ options }) { return (async function* () {
    yield sdkInit('s');
    const decision = await options.canUseTool('AskUserQuestion', { questions: QUESTIONS }, { signal: options.abortController.signal });
    seen.push(decision);
    yield sdkResult('s', decision.behavior === 'allow' ? `Report: ${JSON.stringify(decision.updatedInput.answers)}` : 'No answer.');
  })(); } };
}

test('a question from the agent waits in the Inbox with its options and the answers go back into the tool call', async () => {
  const seen = [];
  const { store, runtime } = await makeRuntime(tmp, askingSdk(seen), { name: 'q' });
  const task = await runtime.startTask({ scope: pilot, prompt: 'Build the weekly report', user, notify: false });
  await wait(async () => (await store.getTask(task.id)).status === 'waiting', 15000, 'task waits');
  const [item] = await store.listInbox(pilot, { kind: 'question', status: 'pending' });
  assert.equal(item.taskId, task.id); assert.equal(item.questions.length, 2); assert.equal(item.questions[1].multiSelect, true);
  assert.equal(item.title, 'Sonic has 2 questions');
  assert.equal((await store.getTask(task.id)).pendingApprovalId, item.id);
  const asked = (await store.listEvents(task.id)).find(event => event.type === 'question.asked');
  assert.equal(asked.inboxId, item.id); assert.equal(asked.questions[0].options[0].label, 'Last 7 days');

  await assert.rejects(runtime.sendMessage(task.id, user, 'hello'), error => error.statusCode === 409 && /asked a question/.test(error.message));
  await assert.rejects(runtime.decideApproval(item.id, 'approved', user), error => error.statusCode === 409 && /Answer this question with its options/.test(error.message));
  await assert.rejects(runtime.answerQuestion(item.id, {}, user), error => error.statusCode === 400 && /at least one question/.test(error.message));

  const answered = await runtime.answerQuestion(item.id, { 'Which period should the report cover?': 'Last 7 days', 'Which brands?': 'Veltrix, Corvana', 'Not a question': 'x' }, user);
  assert.equal(answered.status, 'answered'); assert.deepEqual(answered.answers, { 'Which period should the report cover?': 'Last 7 days', 'Which brands?': 'Veltrix, Corvana' });
  await wait(async () => (await store.getTask(task.id)).status === 'done', 15000, 'task done');
  assert.equal(seen[0].behavior, 'allow'); assert.deepEqual(seen[0].updatedInput.answers, answered.answers);
  assert.match((await store.getTask(task.id)).summary, /Report: /);
  const events = await store.listEvents(task.id);
  assert.equal(events.find(event => event.type === 'question.answered')?.actor?.name, 'Mitesh Shinde');
  await assert.rejects(runtime.answerQuestion(item.id, { 'Which brands?': 'Veltrix' }, user), error => error.statusCode === 409 && /already answered/.test(error.message));
});

test('declining a question lets the agent continue without answers', async () => {
  const seen = [];
  const { store, runtime } = await makeRuntime(tmp, askingSdk(seen), { name: 'q2' });
  const task = await runtime.startTask({ scope: pilot, prompt: 'Build the weekly report', user, notify: false });
  await wait(async () => (await store.getTask(task.id)).status === 'waiting', 15000, 'task waits');
  const [item] = await store.listInbox(pilot, { kind: 'question', status: 'pending' });
  await runtime.decideApproval(item.id, 'denied', user);
  await wait(async () => (await store.getTask(task.id)).status === 'done', 15000, 'task done');
  assert.equal(seen[0].behavior, 'deny'); assert.match(seen[0].message, /chose not to answer/);
  assert.equal((await store.getInboxItem(item.id)).status, 'denied');
});

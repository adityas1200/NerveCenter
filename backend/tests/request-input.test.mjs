import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRuntime, sdkInit, sdkResult, tempDir, wait, pilot } from './helpers.mjs';

// SPEC-tasks-10 FR-20: request_input pauses the task with a typed form; the answers come back as the tool's input.
const tmp = await tempDir('nc-request-input-');
const user = { id: 'mitesh.shinde', name: 'Mitesh Shinde' };

const FORM = { title: 'Which period and brands should the report cover?', reason: 'The weekly report needs a window.', fields: [
  { label: 'From', type: 'date', required: true },
  { label: 'Brands', type: 'multiselect', options: ['Veltrix', 'Corvana'] },
  { label: 'Include gold?', type: 'boolean' },
  { label: 'Notes', type: 'textarea', placeholder: 'Anything else' },
] };

function formSdk(seen) {
  return { query({ options }) { return (async function* () {
    yield sdkInit('s');
    const decision = await options.canUseTool('mcp__nervecenter__request_input', FORM, { signal: options.abortController.signal });
    seen.push(decision);
    yield sdkResult('s', decision.behavior === 'allow' ? `Got ${JSON.stringify(decision.updatedInput.answers)}` : 'No form.');
  })(); } };
}

test('FR-20: the form waits in the Inbox as typed questions and the answers go back keyed by field label', async () => {
  const seen = [];
  const { store, runtime } = await makeRuntime(tmp, formSdk(seen), { name: 'form' });
  const task = await runtime.startTask({ scope: pilot, prompt: 'Build the weekly report', user, notify: false });
  await wait(async () => (await store.getTask(task.id)).status === 'waiting', 15000, 'task waits');
  const [item] = await store.listInbox(pilot, { kind: 'question', status: 'pending' });
  assert.equal(item.title, FORM.title);
  assert.deepEqual(item.questions.map(question => [question.question, question.field.type, question.options.map(option => option.label)]), [['From', 'date', []], ['Brands', 'multiselect', ['Veltrix', 'Corvana']], ['Include gold?', 'boolean', ['Yes', 'No']], ['Notes', 'textarea', []]]);
  assert.equal(item.questions[0].field.required, true); assert.equal(item.questions[1].multiSelect, true);
  const asked = (await store.listEvents(task.id)).find(event => event.type === 'question.asked');
  assert.equal(asked.form, true); assert.equal(asked.reason, FORM.reason);

  await assert.rejects(runtime.answerQuestion(item.id, { Brands: 'Veltrix' }, user), /Fill in From/);
  const answered = await runtime.answerQuestion(item.id, { From: '2026-10-05', Brands: 'Veltrix, Corvana', 'Include gold?': 'No' }, user);
  assert.deepEqual(answered.answers, { From: '2026-10-05', Brands: 'Veltrix, Corvana', 'Include gold?': 'No' });
  await wait(async () => (await store.getTask(task.id)).status === 'done', 15000, 'task done');
  assert.equal(seen[0].behavior, 'allow'); assert.deepEqual(seen[0].updatedInput.answers, answered.answers);
  assert.equal(seen[0].updatedInput.title, FORM.title, 'the rest of the input is kept');
});

test('FR-20: declining the form lets Sonic continue without the values', async () => {
  const seen = [];
  const { store, runtime } = await makeRuntime(tmp, formSdk(seen), { name: 'form-declined' });
  const task = await runtime.startTask({ scope: pilot, prompt: 'Build the weekly report', user, notify: false });
  await wait(async () => (await store.getTask(task.id)).status === 'waiting', 15000, 'task waits');
  const [item] = await store.listInbox(pilot, { kind: 'question', status: 'pending' });
  await runtime.decideApproval(item.id, 'denied', user);
  await wait(async () => (await store.getTask(task.id)).status === 'done', 15000, 'task done');
  assert.equal(seen[0].behavior, 'deny'); assert.match(seen[0].message, /chose not to fill in the form/);
});

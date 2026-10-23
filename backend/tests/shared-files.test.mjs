import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRuntime, sdkInit, sdkResult, tempDir, wait, pilot } from './helpers.mjs';

// SPEC-tasks-09: the agent decides which files a person sees by linking them.
const tmp = await tempDir('nc-shared-files-');

test('FR-5: the prompt asks for links to files a person needs, not working files', async () => {
  const calls = [];
  const sdk = { query: ({ options }) => { calls.push(options); return (async function* () { yield sdkInit('s-1'); yield sdkResult('s-1', 'Done.'); })(); } };
  const { runtime, store } = await makeRuntime(tmp, sdk, { name: 'prompt' });
  const task = await runtime.startTask({ scope: pilot, prompt: 'send the failure email', user: { id: 'mitesh', name: 'Mitesh' }, notify: false });
  await wait(async () => (await store.getTask(task.id)).status === 'done');
  const append = calls[0].systemPrompt.append;
  assert.match(append, /Link only the files a person needs to read, open or forward/);
  assert.match(append, /Do not link working files such as request payloads, JSON inputs to scripts, text copies of an email/);
  assert.doesNotMatch(append, /Link every file you create/);
});

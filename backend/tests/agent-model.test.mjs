import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AGENT_DEFAULTS, resolveAgentModel, validateAgentSection } from '../src/tasks/agent-model.mjs';
import { createWorkspace, validateOperations } from '../src/workspace/workspace.mjs';
import { makeRuntime, sdkInit, tempDir, wait, pilot } from './helpers.mjs';

const tmp = await tempDir('nc-agent-model-');
const user = { id: 'mitesh', name: 'Mitesh' };

test('model and effort: Settings first, then the deployment env, then Sonnet at high', () => {
  assert.deepEqual(AGENT_DEFAULTS, { model: 'sonnet', effort: 'high' });
  assert.deepEqual(resolveAgentModel(undefined, {}), { model: 'sonnet', effort: 'high' });
  assert.deepEqual(resolveAgentModel({ model: 'opus', effort: 'max' }, {}), { model: 'opus', effort: 'max' });
  assert.deepEqual(resolveAgentModel({ model: 'opus', effort: 'max' }, { OPS_AGENT_MODEL: 'haiku', OPS_AGENT_EFFORT: 'low' }), { model: 'opus', effort: 'max' });
  assert.deepEqual(resolveAgentModel(undefined, { OPS_AGENT_MODEL: 'claude-opus-4-8', OPS_AGENT_EFFORT: 'medium' }), { model: 'claude-opus-4-8', effort: 'medium' });
  // Haiku takes no effort level; an unknown value falls back rather than reaching the SDK.
  assert.deepEqual(resolveAgentModel({ model: 'haiku', effort: 'high' }, {}), { model: 'haiku', effort: null });
  // Fable, the most capable family, takes an effort level like Opus and Sonnet.
  assert.deepEqual(resolveAgentModel({ model: 'fable', effort: 'xhigh' }, {}), { model: 'fable', effort: 'xhigh' });
  assert.deepEqual(resolveAgentModel({ model: 'gpt', effort: 'extreme' }, {}), { model: 'sonnet', effort: 'high' });
});

test('operations.yaml agent: bad values are reported and refused on save', async () => {
  assert.deepEqual(validateAgentSection(undefined), []);
  assert.deepEqual(validateAgentSection({ model: 'sonnet', effort: 'xhigh' }), []);
  assert.deepEqual(validateAgentSection({ model: 'gpt', effort: 'extreme' }), ['agent.model must be opus, sonnet, haiku, fable', 'agent.effort must be low, medium, high, xhigh, max']);
  assert.ok(validateOperations({ team: { name: 'x', timezone: 'UTC' }, agent: 'opus' }).errors.includes('agent must be a mapping'));
  const ws = await createWorkspace({ dir: path.join(tmp, 'ws-save') });
  assert.deepEqual(await ws.setSection('agent', { model: 'opus', effort: 'medium' }), { model: 'opus', effort: 'medium' });
  assert.ok(!(await ws.validate()).warnings.some(warning => /unrecognized/.test(warning) && /agent/.test(warning)));
  await assert.rejects(ws.setSection('agent', { model: 'gpt' }), /agent.model must be/);
  assert.deepEqual((await ws.readOperations()).agent, { model: 'opus', effort: 'medium' });
});

test('each run passes the model and effort from Settings to the SDK', async () => {
  const calls = [];
  const sdk = { query: ({ options }) => { calls.push(options); return (async function* () { yield sdkInit(`s-${calls.length}`); yield { type: 'result', subtype: 'success', result: 'Done.', session_id: `s-${calls.length}`, total_cost_usd: 0, num_turns: 1 }; })(); } };
  const { workspace, store, runtime } = await makeRuntime(tmp, sdk, { name: 'run', model: undefined });
  const task = await runtime.startTask({ scope: pilot, prompt: 'hello', user, notify: false });
  await wait(async () => (await store.getTask(task.id)).status === 'done');
  assert.equal(calls[0].model, 'sonnet'); assert.equal(calls[0].effort, 'high');
  // A change in Settings applies from the next message.
  await workspace.setSection('agent', { model: 'haiku', effort: 'high' });
  await runtime.sendMessage(task.id, user, 'again');
  await wait(async () => calls.length === 2 && (await store.getTask(task.id)).status === 'done');
  assert.equal(calls[1].model, 'haiku'); assert.equal('effort' in calls[1], false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fakeSdk, makeRuntime, tempDir, wait, pilot } from './helpers.mjs';

// Records a person points at with @ in the message box travel with that message only, inside the
// turn's <task_context>, so the agent reads them before answering.

const tmp = await tempDir('nc-task-mentions-');
const user = { id: 'mitesh', name: 'Mitesh' };

test('@ mentions reach the agent with the message they were typed in, and not with the next one', async () => {
  const sdk = fakeSdk();
  const { runtime } = await makeRuntime(tmp, sdk, { name: 'mentions', maxConcurrent: 1 });
  const mentions = [
    { kind: 'ticket', id: 'OPS-12', title: 'Sales load failed' },
    { kind: 'table', id: 'commercial.silver.sales_fact' },
    { kind: 'pipeline' },
  ];
  const task = await runtime.startTask({ scope: pilot, prompt: 'Why did @INC0012 fail and is @commercial.silver.sales_fact stale?', user, context: { page: { name: 'Tickets', path: '/tickets', mentions } } });
  await wait(async () => (await runtime.getTask(task.id)).status === 'done');
  assert.match(sdk.calls[0].prompt, /<screen>[\s\S]*Pointed at with @ in this message: ticket OPS-12 \(Sales load failed\); table commercial\.silver\.sales_fact\. Read each one/);
  assert.doesNotMatch(sdk.calls[0].prompt, /pipeline undefined/);

  await runtime.sendMessage(task.id, user, 'thanks', { context: { page: { name: 'Tickets', path: '/tickets' } } });
  await wait(async () => sdk.calls.length === 2 && (await runtime.getTask(task.id)).status === 'done');
  assert.doesNotMatch(sdk.calls[1].prompt, /Pointed at with @/);
});

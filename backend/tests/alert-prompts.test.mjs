import test from 'node:test';
import assert from 'node:assert/strict';
import { alertHeadline, alertPrompt, ticketDraft, ticketNotes } from '../src/monitoring/alert-prompts.mjs';
import { fakeSdk, makeRuntime, pilot, tempDir, wait } from './helpers.mjs';

// SPEC-automations-01 FR-17, FR-19..FR-21: what an automatic investigation is told, and how its alert reaches the agent.

const tmp = await tempDir('nc-alert-prompts-', { maxRetries: 5 });
const failed = { id: 'AL-1', trigger: 'pipelineFailed', subject: { type: 'pipeline', id: '42', platform: 'databricks', name: 'sales_load' }, occurrences: [{ kind: 'failed', runId: 'r1', at: '2026-10-06T07:05:00Z', failingTask: 'load', summary: 'File not found' }] };
const missed = { id: 'AL-2', trigger: 'pipelineLate', subject: { type: 'pipeline', id: '42', platform: 'databricks', name: 'sales_load' }, occurrences: [{ kind: 'missed', slot: '2026-10-06T07:00:00Z', at: '2026-10-06T07:00:00Z' }, { kind: 'missed', slot: '2026-10-06T07:30:00Z', at: '2026-10-06T07:30:00Z' }] };

test('FR-19: the first message states the facts, the method and where the playbook is', () => {
  const prompt = alertPrompt(failed);
  assert.match(prompt, /^Pipeline sales_load failed\./);
  assert.match(prompt, /run r1 failed at 2026-10-06 07:05 UTC, task load: File not found/);
  assert.match(prompt, /Read-only: do not change any system/);
  assert.match(prompt, /rca skill/);
  assert.match(prompt, /search_knowledge for "pipeline failure playbook" and for "sales_load"/);
  assert.match(prompt, /playbooks\/pipeline-failed\.md/);
  const pinned = alertPrompt(missed, { permission: 'policy', playbook: 'playbooks/sales-late.md', ticket: { number: 'INC0012' } });
  assert.match(pinned, /missed 2 scheduled runs/);
  assert.match(pinned, /playbook for this is playbooks\/sales-late\.md; Read it/);
  assert.match(pinned, /needs approval under the project policy/);
  assert.match(pinned, /ticket INC0012/);
});

test('FR-20: Sonic is asked to check the playbook, go beyond it and report deviations and knowledge updates', () => {
  const prompt = alertPrompt(failed);
  assert.match(prompt, /check each against the evidence, and go beyond it/);
  assert.match(prompt, /With no playbook, reason from the rca method/);
  assert.match(prompt, /the playbook you used \(or "none"\), where you deviated from it and why, and any knowledge update you would propose/);
  assert.match(prompt, /Do not ask a question/);
});

test('FR-36: ticket text is plain and names what happened', () => {
  assert.equal(alertHeadline(missed), 'Pipeline sales_load missed 2 scheduled runs');
  assert.match(ticketDraft(failed).description, /Opened automatically by NerveCenter/);
  assert.match(ticketNotes.started(failed, 'T-9'), /task T-9/);
  assert.match(ticketNotes.recovered(failed, { runId: 'r2' }), /run r2 succeeded/);
  assert.match(ticketNotes.finished({ status: 'done', report: 'Cause: late file.' }), /Cause: late file\./);
});

test('FR-17, FR-21: an alert task starts with the alert marked untrusted in its first message', async () => {
  const sdk = fakeSdk();
  const { runtime } = await makeRuntime(tmp, sdk);
  const task = await runtime.startTask({ scope: pilot, type: 'alert', title: alertHeadline(failed), prompt: alertPrompt(failed), permission: 'read-only', notify: true, context: { alert: { alertId: 'AL-1', trigger: 'pipelineFailed', subject: failed.subject, occurrences: failed.occurrences } } });
  assert.equal(task.type, 'alert');
  await wait(() => sdk.calls.length === 1, 5000, 'the first turn');
  const sent = typeof sdk.calls[0].prompt === 'string' ? sdk.calls[0].prompt : JSON.stringify(sdk.calls[0].prompt);
  assert.match(sent, /<alert trust="untrusted">/);
  assert.match(sent, /AL-1/);
  await wait(async () => ['done', 'waiting', 'failed'].includes((await runtime.getTask(task.id)).status), 5000, 'the turn to finish');
  await assert.rejects(runtime.startTask({ scope: pilot, type: 'pipeline-rca', prompt: 'x' }), /type must be ticket, routine, alert, or adhoc/);
});

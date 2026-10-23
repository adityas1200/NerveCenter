import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { automationActive, effectiveAutomation, fetchSeconds, retainDays, triggerFor, validateAutomation, validateSync } from '../src/monitoring/automation-settings.mjs';
import { automaticSyncSettings } from '../src/sync/sync-settings.mjs';
import { createWorkspace } from '../src/workspace/workspace.mjs';
import { tempDir } from './helpers.mjs';

// SPEC-platform-10 (fetch cadence per project) and SPEC-automations-01 FR-1..FR-5 (automation settings).

const tmp = await tempDir('nc-automation-settings-');

test('SPEC-platform-10 FR-1: each source has its own cadence with defaults and bounds', () => {
  assert.equal(fetchSeconds({}, 'pipelines'), 300);
  assert.equal(fetchSeconds({}, 'dataQuality'), 900);
  assert.equal(fetchSeconds({}, 'tickets'), null);
  assert.equal(fetchSeconds({ sync: { pipelines: { every: 2, unit: 'minutes' } } }, 'pipelines'), 120);
  assert.equal(fetchSeconds({ sync: { tickets: { every: 1, unit: 'hours' } } }, 'tickets'), 3600);
  assert.equal(retainDays({}), 60);
  assert.equal(retainDays({ sync: { retainDays: 14 } }), 14);
});

test('SPEC-platform-10 FR-2: tickets read their own cadence first, then the shared interval', async () => {
  const workspace = { readOperations: async () => ({ sync: { enabled: true, intervalValue: 15, intervalUnit: 'seconds', tickets: { every: 10, unit: 'minutes' } } }) };
  assert.equal((await automaticSyncSettings(workspace, 15, 'tickets')).intervalSeconds, 600);
  assert.equal((await automaticSyncSettings(workspace, 15)).intervalSeconds, 15);
});

test('SPEC-platform-10 FR-3: a bad cadence is refused with the field named', () => {
  assert.deepEqual(validateSync({ enabled: true, intervalValue: 15, intervalUnit: 'seconds' }), []);
  assert.match(validateSync({ pipelines: { every: 10, unit: 'seconds' } }).join(), /sync\.pipelines must be between 30 seconds and 24 hours/);
  assert.match(validateSync({ dataQuality: { every: 2, unit: 'days' } }).join(), /sync\.dataQuality\.unit/);
  assert.match(validateSync({ retainDays: 0 }).join(), /sync\.retainDays/);
});

test('FR-1, FR-2, D4: without an automation section the project keeps one ticket per failed Databricks run', () => {
  const config = effectiveAutomation({});
  assert.equal(config.legacy, true);
  assert.equal(triggerFor(config, 'pipelineFailed', { pipelineId: '1', platform: 'databricks' }).action, 'ticket');
  assert.equal(triggerFor(config, 'pipelineFailed', { pipelineId: 'task:x', platform: 'snowflake' }).action, 'off');
  assert.equal(triggerFor(config, 'pipelineLate', { pipelineId: '1', platform: 'databricks' }).action, 'off');
  assert.equal(triggerFor(config, 'dqFailed', { tableId: 'dq-1' }).action, 'off');
  assert.equal(automationActive(config), true);
});

test('FR-1: a saved section fills its defaults; overrides change one pipeline or table; the switch turns everything off', () => {
  const config = effectiveAutomation({ automation: { pipelineFailed: { action: 'task' }, overrides: { pipelines: { '42': { pipelineFailed: { action: 'task_and_ticket', ticket: { priority: 'critical' } }, pipelineLate: { action: 'task', graceMinutes: 45 } } }, tables: { 'dq-2': { dqFailed: { action: 'ticket', minSeverity: 'critical' } } } } } });
  assert.equal(config.legacy, false);
  assert.deepEqual(config.limits, { maxConcurrent: 3, maxPerDay: 50, cooldownMinutes: 30, reopenHours: 24 });
  assert.equal(triggerFor(config, 'pipelineFailed', { pipelineId: '1', platform: 'snowflake' }).action, 'task');
  const one = triggerFor(config, 'pipelineFailed', { pipelineId: '42' });
  assert.deepEqual([one.action, one.ticket.priority, one.ticket.platform], ['task_and_ticket', 'critical', 'auto']);
  assert.deepEqual([triggerFor(config, 'pipelineLate', { pipelineId: '42' }).graceMinutes, triggerFor(config, 'pipelineLate', { pipelineId: '7' }).action], [45, 'off']);
  assert.equal(triggerFor(config, 'dqFailed', { tableId: 'dq-2' }).minSeverity, 'critical');
  const off = effectiveAutomation({ automation: { enabled: false, pipelineFailed: { action: 'task' } } });
  assert.equal(triggerFor(off, 'pipelineFailed', { pipelineId: '1' }).action, 'off');
  assert.equal(automationActive(off), false);
  assert.equal(automationActive(effectiveAutomation({ automation: { overrides: { tables: { 'dq-1': { dqFailed: { action: 'task' } } } } } })), true);
});

test('FR-3: an invalid automation is refused with the field named', () => {
  assert.deepEqual(validateAutomation({ pipelineFailed: { action: 'task', permission: 'policy' }, limits: { maxPerDay: 10 } }), []);
  const problems = validateAutomation({ pipelineFailed: { action: 'fix-it', permission: 'allow' }, pipelineLate: { graceMinutes: 500, lookbackHours: 2.5 }, dqFailed: { minSeverity: 'huge' }, limits: { maxConcurrent: 0 }, ticket: { platform: 'email' }, surprise: true, overrides: { pipelines: { '1': { dqFailed: { action: 'task' } } } } }).join('\n');
  for (const field of ['automation.pipelineFailed.action', 'automation.pipelineFailed.permission', 'automation.pipelineLate.graceMinutes', 'automation.pipelineLate.lookbackHours', 'automation.dqFailed.minSeverity', 'automation.limits.maxConcurrent', 'automation.ticket.platform', 'automation.surprise', 'automation.overrides.pipelines.1.dqFailed']) assert.match(problems, new RegExp(field.replace(/\./g, '\\.')));
});

test('FR-3, SPEC-platform-10 FR-3: Settings refuses a bad section before it reaches operations.yaml', async () => {
  const workspace = await createWorkspace({ dir: path.join(tmp, 'ws') });
  await assert.rejects(workspace.setSection('automation', { pipelineFailed: { action: 'explode' } }), error => error.statusCode === 400 && /automation\.pipelineFailed\.action/.test(error.message));
  await assert.rejects(workspace.setSection('sync', { pipelines: { every: 5, unit: 'seconds' } }), error => error.statusCode === 400 && /sync\.pipelines/.test(error.message));
  assert.equal((await workspace.readOperations()).automation, undefined);
  await workspace.setSection('automation', { pipelineFailed: { action: 'task' } });
  assert.equal((await workspace.readOperations()).automation.pipelineFailed.action, 'task');
  assert.deepEqual((await workspace.validate()).errors.filter(error => /automation|sync/.test(error)), []);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { libraryRoutes } from '../src/api/library-routes.mjs';
import { adminRoutePermission } from '../src/app/rbac.mjs';
import { createSecretStore } from '../src/secrets/secret-store.mjs';
import { KnowledgeService } from '../src/knowledge/knowledge-service.mjs';
import { PASS_ROUTINE, scheduleOf } from '../src/knowledge/knowledge-pass.mjs';
import { RoutineScheduler } from '../src/routines/routine-scheduler.mjs';
import { TOOL_CATEGORIES } from '../src/tasks/nervecenter-tool-categories.mjs';
import { createAppTools } from '../src/tasks/nervecenter-tools.mjs';
import { fakeMcpSdk, makeRuntime, sdkInit, sdkResult, tempDir } from './helpers.mjs';
import { serveRoutes } from './knowledge-harness.mjs';

// SPEC-knowledge-07: the weekly knowledge pass is a routine the owner turns on; its digest is recorded only by that routine.

const tmp = await tempDir('nc-knowledge-pass-', { maxRetries: 3 });
const quietSdk = { query: () => (async function* () { yield sdkInit('s'); yield sdkResult('s', 'Done.'); })() };
let counter = 0;

async function setup() {
  counter += 1;
  const { workspace, store, runtime } = await makeRuntime(tmp, quietSdk, { name: `pass-${counter}` });
  const knowledge = new KnowledgeService({ workspace, secretStore: createSecretStore(), runtime });
  const routines = new RoutineScheduler({ workspace, runtime, stateFile: path.join(tmp, `state-${counter}.json`), clock: () => new Date('2026-10-20T10:00:00Z') });
  const server = await serveRoutes(libraryRoutes({ knowledge, routines }));
  const tools = task => createAppTools({ operationsService: {}, taskStore: store, routines, knowledge, knowledgeDrafts: knowledge.drafts, workspaces: workspace, agentName: 'Sonic' })(task, fakeMcpSdk);
  return { workspace, knowledge, routines, server, tools };
}
const errorOf = async (server, name, args) => (await server.tools.find(item => item.name === name).handler(args)).content[0].text;
const digest = { drafts: { waiting: 9, fromCorrections: 4, fromLessons: 5, merged: 1 }, stale: [{ path: 'ops/runbooks/old.md', staleAfter: '2026-09-01' }, { path: 'ops/a.md' }, { path: 'ops/b.md' }], drift: [{ path: 'ops/pipelines/sales.md', field: 'sla', page: '07:00', live: '08:00' }], gaps: [{ text: 'Did not know who approves Brand X refreshes.', journey: 'brand-request', tasks: ['T-4'] }], evals: [{ journey: 'late-pipeline', score: 84, previous: 78 }], weakest: 'brand-request', summary: 'Nine drafts wait; three pages are stale; late-pipeline went from 78 to 84.', reason: 'Record the weekly digest.' };

test('the weekly cron reads back as weekday and time; anything else gets the defaults', () => {
  assert.deepEqual(scheduleOf('30 6 * * 5'), { weekday: 5, time: '06:30' });
  assert.deepEqual(scheduleOf('0 7 * * 1-5'), { weekday: 1, time: '07:00' });
  assert.deepEqual(scheduleOf(undefined), { weekday: 1, time: '07:00' });
});

test('FR-1 FR-2 S1 an owner turns the pass on: a weekly Monday 07:00 policy routine, shown with its next run', async () => {
  const { server, workspace } = await setup();
  try {
    const off = await server.call('GET', '/api/knowledge/pass', { userId: 'viewer' });
    assert.equal(off.status, 200);
    assert.deepEqual(off.body, { enabled: false, weekday: 1, time: '07:00', timezone: null, routine: null, digest: null });
    const on = await server.call('PUT', '/api/knowledge/pass', { body: { enabled: true } });
    assert.equal(on.status, 200);
    assert.equal(on.body.enabled, true); assert.equal(on.body.weekday, 1); assert.equal(on.body.time, '07:00');
    assert.equal(on.body.routine.name, PASS_ROUTINE); assert.equal(on.body.routine.nextRunAt, '2026-10-26T07:00:00.000Z');
    const saved = YAML.parse(await fs.readFile(path.join(workspace.dir, 'workflows', `${PASS_ROUTINE}.yaml`), 'utf8'));
    assert.equal(saved.trigger.expression, '0 7 * * 1');
    assert.deepEqual(saved.authority, { default_write: 'policy' });
    assert.equal(saved.app.title, 'Weekly knowledge pass'); assert.equal(saved.app.notify, 'on_complete');
    assert.match(saved.objective, /knowledge-pass skill/);

    const moved = await server.call('PUT', '/api/knowledge/pass', { body: { enabled: true, weekday: 5, time: '06:30' } });
    assert.deepEqual([moved.body.weekday, moved.body.time], [5, '06:30']);
    const paused = await server.call('PUT', '/api/knowledge/pass', { body: { enabled: false } });
    assert.equal(paused.body.enabled, false); assert.equal(paused.body.routine.nextRunAt, null);
    assert.deepEqual([paused.body.weekday, paused.body.time], [5, '06:30'], 'pausing keeps the schedule');
  } finally { await server.close(); }
});

test('FR-2 S2 developers and viewers get 403; bad input gets 400; pausing a missing routine is fine', async () => {
  const { server } = await setup();
  try {
    assert.equal(adminRoutePermission('PUT', '/api/knowledge/pass'), 'knowledge.review');
    for (const userId of ['dev', 'viewer']) assert.equal((await server.call('PUT', '/api/knowledge/pass', { body: { enabled: true }, userId })).status, 403, userId);
    assert.equal((await server.call('PUT', '/api/knowledge/pass', { body: { enabled: true, weekday: 7 } })).status, 400);
    assert.equal((await server.call('PUT', '/api/knowledge/pass', { body: { enabled: true, time: '7am' } })).status, 400);
    assert.equal((await server.call('PUT', '/api/knowledge/pass', { body: { enabled: 'yes' } })).status, 400);
    const off = await server.call('PUT', '/api/knowledge/pass', { body: { enabled: false } });
    assert.equal(off.status, 200); assert.equal(off.body.routine, null);
  } finally { await server.close(); }
});

test('FR-3 S3 the digest outside the knowledge-pass routine, or in its test run, errors and writes nothing', async () => {
  const { tools, workspace, server } = await setup();
  try {
    assert.equal(TOOL_CATEGORIES.record_knowledge_digest, 'task_files');
    assert.match(await errorOf(tools({ id: 'T-1', projectId: 'pilot' }), 'record_knowledge_digest', digest), /The digest belongs to the weekly knowledge pass/);
    assert.match(await errorOf(tools({ id: 'T-2', projectId: 'pilot', context: { routine: { name: 'daily-review' } } }), 'record_knowledge_digest', digest), /The digest belongs to the weekly knowledge pass/);
    assert.match(await errorOf(tools({ id: 'T-3', projectId: 'pilot', context: { routine: { name: PASS_ROUTINE, test: true } } }), 'record_knowledge_digest', digest), /test run/);
    await assert.rejects(fs.readFile(path.join(workspace.knowledgeDir, '.journeys.json'), 'utf8'), /ENOENT/);
    await assert.rejects(fs.readFile(path.join(await workspace.taskDir('T-1'), 'knowledge-digest.json'), 'utf8'), /ENOENT/);
  } finally { await server.close(); }
});

test('FR-3 FR-4 S4 the pass records its digest: the task file, the history (12 kept) and GET /api/knowledge/pass', async () => {
  const { tools, workspace, knowledge, server } = await setup();
  try {
    const pass = tools({ id: 'T-7', projectId: 'pilot', context: { routine: { name: PASS_ROUTINE } } });
    const recorded = await pass.call('record_knowledge_digest', digest);
    assert.equal(recorded.recorded, true);
    const file = JSON.parse(await fs.readFile(path.join(await workspace.taskDir('T-7'), 'knowledge-digest.json'), 'utf8'));
    assert.equal(file.taskId, 'T-7'); assert.equal(file.drafts.waiting, 9); assert.equal(file.stale.length, 3);
    const { body } = await server.call('GET', '/api/knowledge/pass', { userId: 'viewer' });
    assert.equal(body.digest.taskId, 'T-7');
    assert.deepEqual(body.digest.evals, [{ journey: 'late-pipeline', score: 84, previous: 78 }]);
    assert.deepEqual(body.digest.drift, digest.drift);
    assert.equal(body.digest.weakest, 'brand-request');
    assert.match(await errorOf(pass, 'record_knowledge_digest', { ...digest, summary: 'Use token = dapi0123456789abcdef0123456789abcdef' }), /credential/);
    for (let i = 0; i < 13; i += 1) await knowledge.journeys.recordDigest({ summary: `Week ${i}` }, { taskId: `T-${100 + i}` });
    const history = JSON.parse(await fs.readFile(path.join(workspace.knowledgeDir, '.journeys.json'), 'utf8'));
    assert.equal(history.digests.length, 12); assert.equal(history.digests.at(-1).summary, 'Week 12');
  } finally { await server.close(); }
});

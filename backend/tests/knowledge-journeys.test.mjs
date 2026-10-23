import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { libraryRoutes } from '../src/api/library-routes.mjs';
import { createWorkspace } from '../src/workspace/workspace.mjs';
import { createSecretStore } from '../src/secrets/secret-store.mjs';
import { KnowledgeService } from '../src/knowledge/knowledge-service.mjs';
import { casePath, scoreOf } from '../src/knowledge/knowledge-journeys.mjs';
import { TOOL_CATEGORIES } from '../src/tasks/nervecenter-tool-categories.mjs';
import { FileTaskStore } from '../src/tasks/task-store.mjs';
import { createAppTools } from '../src/tasks/nervecenter-tools.mjs';
import { fakeMcpSdk, tempDir } from './helpers.mjs';
import { serveRoutes } from './knowledge-harness.mjs';

// SPEC-knowledge-06: eval cases per journey, runs scored by NerveCenter, the history and the journeys API.

const tmp = await tempDir('nc-knowledge-journeys-', { maxRetries: 3 });
let counter = 0;
const write = async (file, text) => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, text, 'utf8'); };
const evalCase = (journey, { draft = false } = {}) => `---\ntype: Eval Case\ntitle: Case\njourney: ${journey}\nexpected: Rerun after the vendor file lands\nstatus: ${draft ? 'draft' : 'stable'}\n---\n# Case\n\n## Ask\n\nWhy is sales late?\n\n## Expected\n\nRerun.\n`;

async function setup() {
  counter += 1;
  const workspace = await createWorkspace({ dir: path.join(tmp, `ws-${counter}`) });
  const knowledge = new KnowledgeService({ workspace, secretStore: createSecretStore() });
  const dir = path.join(workspace.knowledgeDir, 'ops');
  await write(path.join(dir, 'index.md'), '---\ntype: Index\ntitle: Ops\n---\n# Ops\n');
  for (const name of ['a', 'b', 'c', 'd']) await write(path.join(dir, 'evals', 'late-pipeline', `${name}.md`), evalCase('late-pipeline'));
  await write(path.join(dir, 'evals', 'late-pipeline', 'proposed.md'), evalCase('late-pipeline', { draft: true }));
  await write(path.join(dir, 'evals', 'brand-request', 'a.md'), evalCase('brand-request'));
  await write(path.join(dir, 'runbooks', 'not-a-case.md'), evalCase('late-pipeline'));
  await workspace.writeKnowledgeIndex();
  const taskStore = new FileTaskStore(path.join(tmp, `tasks-${counter}`)); await taskStore.init();
  const tools = (task = { id: 'T-1', projectId: 'pilot', createdBy: { id: 'owner', name: 'Owner' } }) => createAppTools({ operationsService: {}, taskStore, knowledge, knowledgeDrafts: knowledge.drafts, workspaces: workspace, agentName: 'Sonic' })(task, fakeMcpSdk);
  return { workspace, knowledge, tools };
}
const errorOf = async (server, name, args) => (await server.tools.find(item => item.name === name).handler(args)).content[0].text;
const results = list => list.map((result, i) => ({ path: `ops/evals/late-pipeline/${'abcd'[i]}.md`, result }));

test('FR-3 the score is pass 1, partial 0.5, fail 0 as a whole percent; only evals/ pages are cases', () => {
  assert.equal(scoreOf([{ result: 'pass' }, { result: 'pass' }, { result: 'partial' }, { result: 'fail' }]), 63);
  assert.equal(scoreOf([]), 0);
  assert.equal(casePath('knowledge/ops/evals/x/y.md'), 'ops/evals/x/y.md');
  assert.equal(casePath('evals/y.md'), 'evals/y.md');
  for (const bad of ['runbooks/x.md', 'ops/evals/../x.md', 'ops/evals/x.txt', '']) assert.throws(() => casePath(bad), /is not an eval case/, bad);
  assert.equal(TOOL_CATEGORIES.record_eval_run, 'task_files');
});

test('FR-3 FR-4 S1 record_eval_run scores the run, writes the task file and the history', async () => {
  const { knowledge, workspace, tools } = await setup();
  const server = tools();
  const first = await server.call('record_eval_run', { journey: 'late-pipeline', cases: results(['pass', 'fail', 'fail', 'fail']), reason: 'Baseline eval run.' });
  assert.equal(first.score, 25); assert.equal(first.previous, null);
  const second = await server.call('record_eval_run', { journey: 'late-pipeline', cases: results(['pass', 'pass', 'partial', 'fail']).map((item, i) => (i === 3 ? { ...item, note: 'Missed the vendor cut-off.', missing: ['ops/runbooks/vendor.md'] } : item)), reason: 'Weekly eval run.' });
  assert.deepEqual([second.score, second.previous, second.passed, second.partial, second.failed, second.total], [63, 25, 2, 1, 1, 4]);
  const file = JSON.parse(await fs.readFile(path.join(await workspace.taskDir('T-1'), 'eval-run-late-pipeline.json'), 'utf8'));
  assert.equal(file.score, 63); assert.equal(file.taskId, 'T-1'); assert.equal(file.cases.length, 4);
  const history = JSON.parse(await fs.readFile(path.join(workspace.knowledgeDir, '.journeys.json'), 'utf8'));
  assert.equal(history.journeys['late-pipeline'].runs.length, 2);
  const listed = (await knowledge.journeyList()).journeys.find(item => item.journey === 'late-pipeline');
  assert.equal(listed.latest.score, 63); assert.equal(listed.previous, 25); assert.deepEqual(listed.trend, [25, 63]);
  assert.deepEqual(listed.failing.map(item => [item.path, item.result]), [['ops/evals/late-pipeline/c.md', 'partial'], ['ops/evals/late-pipeline/d.md', 'fail']]);
  assert.equal(listed.failing[1].note, 'Missed the vendor cut-off.');
});

test('FR-3 S2 a path outside evals/, an unknown result or a credential refuses the call and records nothing', async () => {
  const { workspace, tools } = await setup();
  const server = tools();
  assert.match(await errorOf(server, 'record_eval_run', { journey: 'late-pipeline', cases: [{ path: 'runbooks/x.md', result: 'pass' }], reason: 'Eval run.' }), /is not an eval case/);
  assert.match(await errorOf(server, 'record_eval_run', { journey: 'Late Pipeline', cases: results(['pass']), reason: 'Eval run.' }), /kebab-case/);
  assert.match(await errorOf(server, 'record_eval_run', { journey: 'late-pipeline', cases: [{ path: 'evals/a.md', result: 'pass', note: 'token = dapi0123456789abcdef0123456789abcdef' }], reason: 'Eval run.' }), /credential/);
  await assert.rejects(fs.readFile(path.join(workspace.knowledgeDir, '.journeys.json'), 'utf8'), /ENOENT/);
});

test('FR-4 S3 a journey keeps its latest 26 runs; old or broken history reads as empty', async () => {
  const { knowledge, workspace } = await setup();
  await fs.writeFile(path.join(workspace.knowledgeDir, '.journeys.json'), '{not json', 'utf8');
  assert.equal((await knowledge.journeyList()).journeys.find(item => item.journey === 'late-pipeline').latest, null);
  for (let i = 0; i < 27; i += 1) await knowledge.journeys.recordRun({ journey: 'late-pipeline', cases: results([i === 0 ? 'fail' : 'pass']) }, { taskId: `T-${i}` });
  const history = JSON.parse(await fs.readFile(path.join(workspace.knowledgeDir, '.journeys.json'), 'utf8'));
  assert.equal(history.journeys['late-pipeline'].runs.length, 26);
  assert.equal(history.journeys['late-pipeline'].runs[0].taskId, 'T-1', 'the oldest run was dropped');
  assert.equal((await knowledge.journeyList()).journeys[0].trend.length, 12);
});

test('FR-1 FR-2 FR-5 GET /api/knowledge/journeys lists journeys from kept cases, weakest first, unrun last', async () => {
  const { knowledge } = await setup();
  await knowledge.journeys.recordRun({ journey: 'late-pipeline', cases: results(['pass', 'fail']) }, { taskId: 'T-1' });
  await knowledge.journeys.recordRun({ journey: 'dq-failure', cases: [{ path: 'ops/evals/dq/a.md', result: 'pass' }] }, { taskId: 'T-2' });
  const server = await serveRoutes(libraryRoutes({ knowledge }));
  try {
    const { status, body } = await server.call('GET', '/api/knowledge/journeys', { userId: 'viewer' });
    assert.equal(status, 200);
    assert.deepEqual(body.journeys.map(item => [item.journey, item.cases, item.latest?.score ?? null]), [['late-pipeline', 4, 50], ['dq-failure', 0, 100], ['brand-request', 1, null]]);
    assert.equal(body.journeys[0].latest.taskId, 'T-1');
  } finally { await server.close(); }
});

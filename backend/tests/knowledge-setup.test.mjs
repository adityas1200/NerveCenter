import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { libraryRoutes } from '../src/api/library-routes.mjs';
import { taskRoutes } from '../src/api/task-routes.mjs';
import { adminRoutePermission, authorizeRoute, permissionsFor, projectUser } from '../src/app/rbac.mjs';
import { KnowledgeService } from '../src/knowledge/knowledge-service.mjs';
import { GUIDE_FILE, MAX_GUIDE_QUESTIONS, readGuide, setupContextLines, setupPrompt, upsertGuide } from '../src/knowledge/knowledge-setup.mjs';
import { sendError, sendJson } from '../src/lib/http.mjs';
import { dispatch } from '../src/lib/router.mjs';
import { PROJECT_HEADER, resolveScope } from '../src/projects/project-access.mjs';
import { createSecretStore } from '../src/secrets/secret-store.mjs';
import { attachmentLines, decodeAttachments } from '../src/tasks/attachments.mjs';
import { TOOL_CATEGORIES } from '../src/tasks/nervecenter-tool-categories.mjs';
import { createAppTools } from '../src/tasks/nervecenter-tools.mjs';
import { fakeMcpSdk, makeRuntime, sdkInit, sdkResult, tempDir, wait, pilot } from './helpers.mjs';

// SPEC-knowledge-03: the owner's knowledge setup task, its interview guide, and the files it takes.

const tmp = await tempDir('nc-knowledge-setup-');
const owner = { id: 'owner', name: 'Olivia Owner' };

function recordingSdk() {
  const calls = [];
  return { calls, query: ({ prompt, options }) => { calls.push({ prompt, options }); return (async function* () { yield sdkInit(`s-${calls.length}`); yield sdkResult(`s-${calls.length}`, 'Done.'); })(); } };
}

async function setupWith(name) {
  const sdk = recordingSdk();
  const made = await makeRuntime(tmp, sdk, { name });
  const knowledge = new KnowledgeService({ workspace: made.workspace, secretStore: createSecretStore(), runtime: made.runtime });
  return { ...made, sdk, knowledge };
}

/* ------------------------------------------------------------- the setup task */

test('FR-1 FR-2 the first setup starts one task aimed at team-knowledge, the next returns it', async () => {
  const { knowledge, runtime, store, workspace, sdk } = await setupWith('first');
  const first = await knowledge.setup({ user: owner });
  assert.equal(first.created, true);
  assert.equal(first.base, 'team-knowledge');
  const task = await runtime.getTask(first.taskId);
  assert.equal(task.title, 'Knowledge setup');
  assert.equal(task.permission, 'policy');
  assert.deepEqual(task.context, { knowledgeSetup: true, knowledgeBase: 'team-knowledge' });
  assert.match(await fs.readFile(path.join(workspace.knowledgeDir, 'team-knowledge', 'index.md'), 'utf8'), /^---\ntype: Index\ntitle: Team knowledge\n/);
  await wait(async () => (await store.getTask(first.taskId)).status === 'done');
  assert.equal(sdk.calls.length, 1);
  const opening = (await store.listEvents(first.taskId)).find(event => event.type === 'user.message');
  assert.match(opening.text, /Use the knowledge-build skill/);
  assert.match(opening.text, /update_knowledge into base "team-knowledge"/);

  const again = await knowledge.setup({ user: owner, base: 'something-else' });
  assert.deepEqual(again, { taskId: first.taskId, base: 'team-knowledge', created: false });
  assert.deepEqual(await knowledge.setupTask(), { taskId: first.taskId, base: 'team-knowledge' });
});

test('FR-1 two clicks at once start one task; a deleted setup task makes way for a new one', async () => {
  const { knowledge, runtime, store } = await setupWith('twice');
  const [a, b] = await Promise.all([knowledge.setup({ user: owner }), knowledge.setup({ user: owner })]);
  assert.equal(a.taskId, b.taskId);
  assert.equal([a.created, b.created].filter(Boolean).length, 1);
  await wait(async () => (await store.getTask(a.taskId)).status === 'done');
  await runtime.deleteTask(a.taskId);
  assert.deepEqual(await knowledge.setupTask(), { taskId: null, base: null });
  const next = await knowledge.setup({ user: owner });
  assert.equal(next.created, true);
  assert.notEqual(next.taskId, a.taskId);
});

test('FR-1 a named base must exist; an existing local base is used as it is', async () => {
  const { knowledge, workspace, runtime } = await setupWith('named');
  await assert.rejects(knowledge.setup({ user: owner, base: 'nope' }), error => error.statusCode === 404 && /Unknown knowledge base: nope/.test(error.message));
  await fs.mkdir(path.join(workspace.knowledgeDir, 'ops-runbooks'), { recursive: true });
  await fs.writeFile(path.join(workspace.knowledgeDir, 'ops-runbooks', 'index.md'), '---\ntype: Index\ntitle: Ops runbooks\n---\n');
  const started = await knowledge.setup({ user: owner, base: 'ops-runbooks' });
  assert.equal(started.base, 'ops-runbooks');
  assert.deepEqual((await runtime.getTask(started.taskId)).context, { knowledgeSetup: true, knowledgeBase: 'ops-runbooks' });
  await assert.rejects(fs.stat(path.join(workspace.knowledgeDir, 'team-knowledge')), 'no team-knowledge is made when a base was chosen');
});

test('FR-2 FR-9 the first message names the skill and base; every turn carries the transcript rules', async () => {
  const prompt = setupPrompt({ base: 'ops-runbooks' });
  assert.match(prompt, /knowledge-build skill/);
  assert.match(prompt, /update_knowledge into base "ops-runbooks"/);
  assert.match(prompt, /update_interview_guide/);
  assert.match(prompt, /charter or ticket history/);
  const lines = setupContextLines({ base: 'ops-runbooks', lead: 'Olivia' }).join('\n');
  for (const rule of [/id said aloud \(G-7\)/, /mark it unconfirmed/, /citing the transcript file, timestamp and speaker/, /Never copy the transcript/, /"Conflict:" note/, /answered, partly or not_discussed/, /next round/]) assert.match(lines, rule);

  const { knowledge, sdk, store } = await setupWith('context');
  const started = await knowledge.setup({ user: owner });
  await wait(async () => (await store.getTask(started.taskId)).status === 'done');
  const append = sdk.calls[0].options.systemPrompt.append;
  assert.match(append, /# Knowledge setup/);
  assert.match(append, /Olivia Owner, the build lead/);
  assert.match(append, /Target base: "team-knowledge"/);
});

test('FR-9 an ordinary task is not told about knowledge setup', async () => {
  const sdk = recordingSdk();
  const { runtime, store } = await makeRuntime(tmp, sdk, { name: 'plain' });
  const task = await runtime.startTask({ scope: pilot, prompt: 'hello', user: owner, notify: false });
  await wait(async () => (await store.getTask(task.id)).status === 'done');
  assert.doesNotMatch(sdk.calls[0].options.systemPrompt.append, /# Knowledge setup/);
});

/* ------------------------------------------------------------------- the guide */

test('FR-6 the guide adds questions with ids, changes only what is sent, and keeps its shape', async () => {
  const dir = path.join(tmp, 'guide-basic'); await fs.mkdir(dir, { recursive: true });
  assert.deepEqual(await readGuide(dir), { questions: [], updatedAt: null });
  const added = await upsertGuide(dir, [
    { theme: 'Orchestration', question: 'Confirm: every load runs from Databricks Workflows, deployed from main?', audience: 'Platform lead', priority: 'high', evidence: [{ label: '42 jobs in Databricks', href: '/monitor' }] },
    { theme: 'Sales load', question: 'INC-4821 was fixed by patching sales_stg by hand. Why, and is that the usual fix?', evidence: [{ label: 'INC-4821', href: 'https://example.service-now.com/inc4821' }] },
  ]);
  assert.deepEqual(added.added, ['G-1', 'G-2']);
  const second = added.questions.find(item => item.id === 'G-2');
  assert.deepEqual({ priority: second.priority, status: second.status, round: second.round, audience: second.audience }, { priority: 'medium', status: 'open', round: 1, audience: '' });

  const changed = await upsertGuide(dir, [{ id: 'G-2', status: 'answered', answer: 'Late upstream file; patch is a stopgap.', cites: [{ file: 'kt-1.vtt', at: '00:12:40', speaker: 'Priya' }], pages: ['known-issues/late-upstream-file.md'] }, { theme: 'Sales load', question: 'Who approves a manual patch?', round: 2 }]);
  assert.deepEqual(changed.changed, ['G-2']); assert.deepEqual(changed.added, ['G-3']);
  const stored = await readGuide(dir);
  const g2 = stored.questions.find(item => item.id === 'G-2');
  assert.equal(g2.question, 'INC-4821 was fixed by patching sales_stg by hand. Why, and is that the usual fix?', 'fields not sent stay');
  assert.equal(g2.status, 'answered');
  assert.deepEqual(g2.pages, ['known-issues/late-upstream-file.md']);
  assert.equal(stored.questions.find(item => item.id === 'G-3').round, 2);
});

test('FR-6 a bad call changes nothing and names the problem', async () => {
  const dir = path.join(tmp, 'guide-guards'); await fs.mkdir(dir, { recursive: true });
  await upsertGuide(dir, [{ theme: 'Data', question: 'Which table is the source of truth for sales?' }]);
  const before = await fs.readFile(path.join(dir, GUIDE_FILE), 'utf8');
  await assert.rejects(upsertGuide(dir, [{ id: 'G-9', status: 'answered' }]), /no G-9 in the guide/);
  await assert.rejects(upsertGuide(dir, [{ theme: 'Data' }]), /needs a theme and the question/);
  await assert.rejects(upsertGuide(dir, [{ theme: 'Data', question: 'x'.repeat(401) }]), /Question 1: question/);
  await assert.rejects(upsertGuide(dir, [{ theme: 'Data', question: 'Open the link', evidence: [{ label: 'site', href: 'http://example.com' }] }]), /href must be an https: URL or an app path/);
  await assert.rejects(upsertGuide(dir, [{ theme: 'Data', question: 'Is the key AKIAABCDEFGHIJKLMNOP still used?' }]), /credential or key/);
  await assert.rejects(upsertGuide(dir, [{ theme: 'Data', question: 'Q?', unknown: true }]), /Question 1/);
  await assert.rejects(upsertGuide(dir, Array.from({ length: MAX_GUIDE_QUESTIONS }, (_, index) => ({ theme: 'Bulk', question: `Question number ${index}?` }))), /at most 80 questions/);
  assert.equal(await fs.readFile(path.join(dir, GUIDE_FILE), 'utf8'), before);
});

test('FR-6 an older or hand-edited guide file still reads with defaults', async () => {
  const dir = path.join(tmp, 'guide-old'); await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, GUIDE_FILE), JSON.stringify({ questions: [{ id: 'G-4', question: 'Who owns the DQ rules?' }, { id: 'nonsense' }, { id: 'G-5', question: 'q', priority: 'urgent', status: 'weird' }] }));
  const guide = await readGuide(dir);
  assert.deepEqual(guide.questions.map(item => [item.id, item.theme, item.priority, item.status, item.round]), [['G-4', 'General', 'medium', 'open', 1], ['G-5', 'General', 'medium', 'open', 1]]);
  assert.deepEqual((await upsertGuide(dir, [{ theme: 'DQ', question: 'Next one?' }])).added, ['G-6']);
});

test('FR-6 update_interview_guide writes the task folder of a setup task and refuses any other task', async () => {
  const { workspace } = await setupWith('tool');
  const tools = createAppTools({ operationsService: {}, taskStore: {}, workspaces: workspace, agentName: 'Sonic' });
  assert.equal(TOOL_CATEGORIES.update_interview_guide, 'task_files');
  const setupServer = tools({ id: 'T-7', projectId: 'pilot', createdBy: owner, context: { knowledgeSetup: true, knowledgeBase: 'team-knowledge' } }, fakeMcpSdk);
  const result = await setupServer.call('update_interview_guide', { questions: [{ theme: 'Ownership', question: 'Who is on call for the sales load at night?' }] });
  assert.deepEqual(result.added, ['G-1']);
  assert.equal(result.counts.open, 1);
  assert.equal((await readGuide(await workspace.taskDir('T-7'))).questions[0].question, 'Who is on call for the sales load at night?');

  const plain = tools({ id: 'T-8', projectId: 'pilot', createdBy: owner, context: {} }, fakeMcpSdk);
  const refused = await plain.tools.find(item => item.name === 'update_interview_guide').handler({ questions: [{ theme: 'x', question: 'y?' }] });
  assert.equal(refused.isError, true);
  assert.match(refused.content[0].text, /belongs to a knowledge setup task/);
  await assert.rejects(fs.stat(path.join(await workspace.taskDir('T-8'), GUIDE_FILE)));
});

/* ------------------------------------------------------------------- attachments */

const b64 = buffer => buffer.toString('base64');
const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('rest of the zip')]);

test('FR-4 Word, Excel, PowerPoint and transcripts attach; renamed files do not', () => {
  const files = decodeAttachments([
    { name: 'charter.docx', data: b64(ZIP) }, { name: 'tickets.xlsx', data: b64(ZIP) }, { name: 'kickoff.pptx', data: b64(ZIP) },
    { name: 'kt-1.vtt', data: b64(Buffer.from('WEBVTT\n\n00:00.000 --> 00:02.000\n<v Priya>Hello\n')) },
    { name: 'kt-2.vtt', data: b64(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('WEBVTT\n')])) },
  ]);
  assert.deepEqual(files.map(file => [file.name, file.mime]), [
    ['charter.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['tickets.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['kickoff.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    ['kt-1.vtt', 'text/vtt'], ['kt-2.vtt', 'text/vtt'],
  ]);
  assert.throws(() => decodeAttachments([{ name: 'charter.docx', data: b64(Buffer.from('not a zip')) }]), /charter\.docx is not a real \.docx file/);
  assert.throws(() => decodeAttachments([{ name: 'notes.vtt', data: b64(Buffer.from('00:00 hello')) }]), /notes\.vtt is not a real \.vtt file/);
  assert.throws(() => decodeAttachments([{ name: 'old.doc', data: b64(ZIP) }]), /Word, Excel or PowerPoint file, a meeting transcript/);
});

test('FR-5 the agent is told how to read Office files, only when there are some', () => {
  const office = attachmentLines([{ name: 'tickets.xlsx', path: 'attachments/q-1/tickets.xlsx', size: 2048, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }], 'tasks/T-1');
  assert.match(office, /Read cannot open Word, Excel or PowerPoint files/);
  assert.match(office, /extract_docs\.py/);
  assert.match(office, /openpyxl/);
  const transcript = attachmentLines([{ name: 'kt.vtt', path: 'attachments/q-1/kt.vtt', size: 900, mime: 'text/vtt' }], 'tasks/T-1');
  assert.doesNotMatch(transcript, /Read cannot open/);
});

/* ------------------------------------------------------------------------ routes */

const routeRoles = { owner: 'owner', dev: 'developer', viewer: 'viewer' };
const projectStore = {
  async memberProjectIds() { return ['pilot']; },
  async get(id) { return id === 'pilot' ? { id: 'pilot', kind: 'normal' } : null; },
  async list() { return [{ id: 'pilot', kind: 'normal' }]; },
  async memberRole(_projectId, userId) { return routeRoles[userId] || null; },
};
const routeSdk = recordingSdk();
const routed = await makeRuntime(tmp, routeSdk, { name: 'routes' });
const routedKnowledge = new KnowledgeService({ workspace: routed.workspace, secretStore: createSecretStore(), runtime: routed.runtime });
let server; let base;
test.before(async () => {
  const routes = [...libraryRoutes({ knowledge: routedKnowledge }), ...taskRoutes({ runtime: routed.runtime, taskStore: routed.store })];
  server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const userId = String(req.headers['x-user-id'] || 'owner');
      const actor = { id: userId, name: userId, role: 'developer', permissions: permissionsFor('developer') };
      const handled = await dispatch(routes, {
        req, res, url, p: url.pathname.split('/').filter(Boolean), m: req.method, user: actor,
        scopeUser: scope => projectUser(actor, scope),
        resolveScope: entry => resolveScope({ store: projectStore, user: actor, header: req.headers[PROJECT_HEADER], scopeClass: entry.scope, method: req.method }),
        authorize: (needs, method, who, scope) => authorizeRoute(who, method, needs, scope),
      });
      if (!handled) sendJson(res, 404, { error: 'Route not found' });
    } catch (error) { sendError(res, error?.statusCode || 500, error); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => new Promise(resolve => server.close(resolve)));

const call = async (method, url, { body, userId = 'owner' } = {}) => {
  const response = await fetch(`${base}${url}`, { method, headers: { 'content-type': 'application/json', [PROJECT_HEADER]: 'pilot', 'x-user-id': userId }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json().catch(() => null) };
};

test('FR-1 POST /api/knowledge/setup is the owner\'s: 201 then 200 with the same task; developers and viewers get 403', async () => {
  assert.equal(adminRoutePermission('POST', '/api/knowledge/setup'), 'knowledge.review');
  assert.deepEqual((await call('GET', '/api/knowledge/setup')).body, { taskId: null, base: null });
  for (const userId of ['dev', 'viewer']) assert.equal((await call('POST', '/api/knowledge/setup', { body: {}, userId })).status, 403, userId);
  const first = await call('POST', '/api/knowledge/setup', { body: {} });
  assert.equal(first.status, 201);
  assert.equal(first.body.base, 'team-knowledge');
  const again = await call('POST', '/api/knowledge/setup', { body: {} });
  assert.equal(again.status, 200);
  assert.equal(again.body.taskId, first.body.taskId);
  assert.deepEqual((await call('GET', '/api/knowledge/setup', { userId: 'viewer' })).body, { taskId: first.body.taskId, base: 'team-knowledge' });
  assert.equal((await call('POST', '/api/knowledge/setup', { body: { base: 'missing' } })).status, 200, 'the open task wins over a new base');
});

test('FR-7 GET /api/tasks/:id/interview-guide returns the setup task\'s guide, an empty one for other tasks', async () => {
  const { taskId } = await routedKnowledge.setupTask();
  await wait(async () => (await routed.store.getTask(taskId)).status === 'done');
  await upsertGuide(await routed.workspace.taskDir(taskId), [{ theme: 'Ownership', question: 'Who owns the DQ rules?', priority: 'high' }]);
  const guide = await call('GET', `/api/tasks/${taskId}/interview-guide`, { userId: 'viewer' });
  assert.equal(guide.status, 200);
  assert.deepEqual(guide.body.questions.map(item => [item.id, item.question, item.priority]), [['G-1', 'Who owns the DQ rules?', 'high']]);

  const other = await routed.runtime.startTask({ scope: pilot, prompt: 'hello', user: owner, notify: false });
  await wait(async () => (await routed.store.getTask(other.id)).status === 'done');
  await upsertGuide(await routed.workspace.taskDir(other.id), [{ theme: 'x', question: 'Planted?' }]);
  assert.deepEqual((await call('GET', `/api/tasks/${other.id}/interview-guide`)).body, { questions: [], updatedAt: null });
  assert.equal((await call('GET', '/api/tasks/T-404/interview-guide')).status, 403, 'a missing task answers like any task outside the project');
});

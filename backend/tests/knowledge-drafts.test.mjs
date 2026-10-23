import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createWorkspace } from '../src/workspace/workspace.mjs';
import { createSecretStore } from '../src/secrets/secret-store.mjs';
import { KnowledgeService } from '../src/knowledge/knowledge-service.mjs';
import { acceptDraftText, cleanPagePath, findSecret, insertUnderSection } from '../src/knowledge/knowledge-drafts.mjs';
import { classifyTool } from '../src/tasks/permission-policy.mjs';
import { FileOperationsStore } from '../src/app/operations-store.mjs';
import { OperationsService } from '../src/app/operations-service.mjs';
import { FileTaskStore } from '../src/tasks/task-store.mjs';
import { createAppTools } from '../src/tasks/nervecenter-tools.mjs';
import { fakeMcpSdk, hasGit, tempDir, pilot } from './helpers.mjs';

// Lesson capture: the agent saves lessons as drafts a person keeps or discards. The code checks
// shape and safety; whether and where to save is the agent's call.

const run = promisify(execFile);
const tmp = await tempDir('nc-knowledge-drafts-', { maxRetries: 3 });
const reviewer = { id: 'mitesh.shinde', name: 'Mitesh Shinde' };

let counter = 0;
async function setup({ withBase = true } = {}) {
  counter += 1;
  const workspace = await createWorkspace({ dir: path.join(tmp, `ws-${counter}`) });
  const secretStore = createSecretStore();
  const knowledge = new KnowledgeService({ workspace, secretStore });
  if (withBase) {
    const dir = path.join(workspace.knowledgeDir, 'ops');
    await fs.mkdir(path.join(dir, 'known-issues'), { recursive: true });
    await fs.writeFile(path.join(dir, 'index.md'), '---\ntype: Index\ntitle: Ops runbooks\ndescription: How the data team runs and repairs its pipelines.\n---\n# Ops runbooks\n\n- [Pipeline failures](known-issues/pipelines.md)\n', 'utf8');
    await fs.writeFile(path.join(dir, 'known-issues', 'pipelines.md'), '---\ntype: Playbook\ntitle: Pipeline failures\ndescription: Recurring pipeline failures, their causes and fixes.\ntags: [pipelines, databricks]\nstatus: stable\n---\n# Pipeline failures\n\n## Late source file\n\nThe vendor drop arrives after 06:00. Rerun after it lands.\n\n## Schema change\n\nA new column breaks the merge. Add it to the target table.\n', 'utf8');
    await workspace.writeKnowledgeIndex();
  }
  return { workspace, knowledge, drafts: knowledge.drafts };
}

test('page paths stay inside a base, are markdown, and never an index', () => {
  assert.equal(cleanPagePath('./known-issues\\pipelines.md'), 'known-issues/pipelines.md');
  assert.throws(() => cleanPagePath('../outside.md'), /not a page inside/);
  assert.throws(() => cleanPagePath('.git/config.md'), /not a page inside/);
  assert.throws(() => cleanPagePath('notes.txt'), /markdown/);
  assert.throws(() => cleanPagePath('known-issues/index.md'), /not to an index/);
});

test('credential shapes are refused, ordinary ops words are not', () => {
  assert.equal(findSecret('Authorization: Bearer abcdefghijklmnop123'), true);
  assert.equal(findSecret('token = dapi0123456789abcdef0123456789abcdef'), true);
  assert.equal(findSecret('-----BEGIN RSA PRIVATE KEY-----'), true);
  assert.equal(findSecret('Rotate the service principal token in the vault, then rerun the job.'), false);
});

test('a section goes at the end of the chosen section, before the next heading of the same level', () => {
  const text = '# Page\n\n## A\n\nOne.\n\n### A detail\n\nMore.\n\n## B\n\nTwo.\n';
  const out = insertUnderSection(text, 'A', 'NEW');
  assert.ok(out.indexOf('NEW') > out.indexOf('More.') && out.indexOf('NEW') < out.indexOf('## B'));
  assert.equal(insertUnderSection(text, 'Missing', 'x'), null);
});

test('keeping a draft drops its markers and marks a new page stable and reviewed', () => {
  const kept = acceptDraftText('---\ntitle: X\nstatus: draft\n---\n# X\n<!-- draft source=OPS-1 updated=2026-09-30 -->\n## Y\nZ\n<!-- /draft -->\n', 'mitesh.shinde');
  assert.match(kept, /status: stable/); assert.match(kept, /verified: \{by: "human:mitesh\.shinde"/);
  assert.doesNotMatch(kept, /<!--/);
});

test('the catalog shows every page with its description and sections, not its body', async () => {
  const { drafts } = await setup();
  const catalog = await drafts.catalog();
  const base = catalog.bases.find(item => item.base === 'ops');
  assert.equal(base.description, 'How the data team runs and repairs its pipelines.');
  const page = base.pages.find(item => item.path === 'known-issues/pipelines.md');
  assert.equal(page.description, 'Recurring pipeline failures, their causes and fixes.');
  assert.deepEqual(page.tags, ['pipelines', 'databricks']);
  assert.deepEqual(page.sections, ['## Late source file', '## Schema change']);
  assert.equal(JSON.stringify(catalog).includes('Rerun after it lands'), false, 'no page bodies');
  const empty = await (await setup({ withBase: false })).drafts.catalog();
  assert.deepEqual(empty.bases, []); assert.match(empty.note, /team-knowledge/);
});

test('saving a lesson needs no approval; a skip writes nothing; raw edits to knowledge still ask', () => {
  const policy = { permission: 'policy', policy: {} };
  assert.equal(classifyTool('mcp__nervecenter__update_knowledge', { decision: 'append' }, policy).verdict, 'allow');
  assert.equal(classifyTool('mcp__nervecenter__update_knowledge', { decision: 'append' }, policy).category, 'knowledge_drafts');
  assert.equal(classifyTool('mcp__nervecenter__update_knowledge', { decision: 'skip' }, { permission: 'read-only' }).verdict, 'allow');
  assert.equal(classifyTool('mcp__nervecenter__update_knowledge', { decision: 'create' }, { permission: 'read-only' }).verdict, 'deny');
  assert.equal(classifyTool('mcp__nervecenter__update_knowledge', { decision: 'create' }, { permission: 'policy', policy: { knowledge_drafts: 'ask' } }).verdict, 'ask', 'a workspace can ask first');
  assert.equal(classifyTool('mcp__nervecenter__knowledge_catalog', {}, { permission: 'read-only' }).verdict, 'allow');
  const taskDir = path.join(tmp, 'ws', 'tasks', 'T-1');
  assert.equal(classifyTool('Write', { file_path: path.join(tmp, 'ws', 'knowledge', 'ops', 'x.md') }, { taskDir, permission: 'policy', policy: {} }).verdict, 'ask');
});

test('an added section is a draft between markers; the page keeps its own status', { skip: !hasGit && 'git is not installed' }, async () => {
  const { drafts, knowledge } = await setup();
  const saved = await drafts.write({ decision: 'append', base: 'ops', path: 'known-issues/pipelines.md', section: 'Schema change', title: 'Schema change on finance_daily', content: 'Also seen on `finance_daily`: the merge failed on `region_code`. Same fix.', placementReason: 'Same cause as "Schema change"; adds where it was seen.', checked: ['ops/known-issues/pipelines.md'], sourceTicket: 'OPS-7' }, { taskId: 'T-3', actor: reviewer });
  assert.equal(saved.saved, true); assert.equal(saved.status, 'draft');
  const text = await fs.readFile(path.join(knowledge.workspace.knowledgeDir, 'ops', 'known-issues', 'pipelines.md'), 'utf8');
  assert.match(text, /status: stable/);
  assert.match(text, /<!-- draft source=OPS-7 updated=\d{4}-\d{2}-\d{2} -->\nAlso seen on `finance_daily`[\s\S]*<!-- \/draft -->\n\n?## |<!-- \/draft -->\s*$/);
  assert.ok(text.indexOf('Also seen') > text.indexOf('## Schema change'));
  const [draft] = await knowledge.listDrafts('ops');
  assert.equal(draft.path, 'known-issues/pipelines.md'); assert.equal(draft.change, 'modified');
  assert.equal(draft.sourceTicket, 'OPS-7'); assert.match(draft.reason, /Same cause/); assert.match(draft.diff, /^\+Also seen on/m);
  assert.equal((await knowledge.list()).items.find(item => item.name === 'ops').pendingChanges, 1);
  const missing = await drafts.write({ decision: 'append', base: 'ops', path: 'known-issues/pipelines.md', section: 'Nope', content: 'x', placementReason: 'x y z', checked: [] }).catch(error => error);
  assert.match(missing.message, /Its sections are: Pipeline failures; Late source file; Schema change/);
});

test('unsafe or careless saves are refused and change nothing', { skip: !hasGit && 'git is not installed' }, async () => {
  const { drafts, knowledge } = await setup();
  const base = { base: 'ops', placementReason: 'a reason', checked: [] };
  await assert.rejects(drafts.write({ ...base, decision: 'create', path: 'known-issues/new.md', title: 'T', content: 'use password: hunter2hunter2' }), /credential/);
  await assert.rejects(drafts.write({ ...base, decision: 'create', path: 'known-issues/pipelines.md', title: 'T', content: 'x' }), /already exists/);
  await assert.rejects(drafts.write({ ...base, decision: 'append', path: 'known-issues/none.md', content: 'x' }), /does not exist/);
  await assert.rejects(drafts.write({ ...base, base: 'elsewhere', decision: 'create', path: 'a.md', title: 'T', content: 'x' }), /choose one of ops/);
  await assert.rejects(drafts.write({ ...base, decision: 'create', path: 'a.md', title: 'T', content: '<!-- draft -->x' }), /draft markers/);
  await assert.rejects(drafts.write({ ...base, decision: 'create', path: '../a.md', title: 'T', content: 'x' }), /not a page inside/);
  assert.deepEqual(await knowledge.listDrafts('ops'), []);
  const skipped = await drafts.write({ decision: 'skip', placementReason: 'Already covered by "Late source file".', checked: ['ops/known-issues/pipelines.md'] });
  assert.equal(skipped.saved, false); assert.deepEqual(skipped.checked, ['ops/known-issues/pipelines.md']);
});

test('the first lesson with no knowledge base creates one, in its own repository, inside a parent repository', { skip: !hasGit && 'git is not installed' }, async () => {
  const { knowledge, drafts, workspace } = await setup({ withBase: false });
  // The workspace itself sits inside a Git repository (as in development): the base must not use it.
  await run('git', ['init', '-q', workspace.dir]);
  const saved = await drafts.write({ decision: 'create', path: 'known-issues/late-files.md', title: 'Late vendor files', description: 'Loads that fail because the vendor file lands late.', type: 'Playbook', tags: ['pipelines', 'Late Files!'], content: '## Symptom\n\nThe load finds no file.\n\n## Fix\n\nRerun after the file lands.', placementReason: 'No knowledge base yet.', checked: [], sourceTicket: 'OPS-9' });
  assert.equal(saved.base, 'team-knowledge'); assert.equal(saved.createdBase, true);
  const dir = path.join(workspace.knowledgeDir, 'team-knowledge');
  const { stdout } = await run('git', ['-C', dir, 'rev-parse', '--show-toplevel']);
  assert.equal(await fs.realpath(stdout.trim()).then(value => value.toLowerCase()), (await fs.realpath(dir)).toLowerCase());
  const page = await fs.readFile(path.join(dir, 'known-issues', 'late-files.md'), 'utf8');
  assert.match(page, /^---\ntype: Playbook\ntitle: Late vendor files\ndescription: Loads that fail because the vendor file lands late\.\ntags: \[pipelines\]\nstatus: draft\nsource: OPS-9\nupdated: /);
  assert.match(page, /# Late vendor files\n\n## Symptom/);
  assert.match(await fs.readFile(path.join(workspace.knowledgeDir, 'index.md'), 'utf8'), /\[Team knowledge\]\(team-knowledge\/index\.md\)/);
  const items = await knowledge.listDrafts('team-knowledge');
  assert.deepEqual(items.map(item => [item.path, item.change]), [['known-issues/late-files.md', 'added']]);
});

test('keeping commits under the reviewer, links a new page from the index; discarding restores', { skip: !hasGit && 'git is not installed' }, async () => {
  const { knowledge, drafts } = await setup();
  const dir = path.join(knowledge.workspace.knowledgeDir, 'ops');
  await drafts.write({ decision: 'create', base: 'ops', path: 'known-issues/cluster-quota.md', title: 'Cluster quota exhausted', description: 'Jobs that cannot start because the workspace hit its quota.', content: 'Ask the platform team to raise the quota.', placementReason: 'No page covers capacity failures.', checked: ['ops/known-issues/pipelines.md'], sourceTicket: 'OPS-11' });
  await drafts.write({ decision: 'append', base: 'ops', path: 'known-issues/pipelines.md', content: '## Expired token\n\nRotate the service principal secret.', placementReason: 'A recurring pipeline failure.', checked: [], sourceTicket: 'OPS-12' });
  assert.equal((await knowledge.listDrafts('ops')).length, 2);

  await assert.rejects(knowledge.keepDrafts('ops', 'known-issues/none.md', reviewer), /no draft/);
  const kept = await knowledge.keepDrafts('ops', 'known-issues/cluster-quota.md', reviewer);
  assert.deepEqual(kept.kept, ['known-issues/cluster-quota.md']);
  const page = await fs.readFile(path.join(dir, 'known-issues', 'cluster-quota.md'), 'utf8');
  assert.match(page, /status: stable/); assert.match(page, /human:mitesh\.shinde/);
  assert.match(await fs.readFile(path.join(dir, 'index.md'), 'utf8'), /- \[Cluster quota exhausted\]\(known-issues\/cluster-quota\.md\): Jobs that cannot start/);
  const log = await run('git', ['-C', dir, 'log', '-1', '--format=%an|%s']);
  assert.equal(log.stdout.trim(), 'Mitesh Shinde|Keep knowledge: Cluster quota exhausted');

  const discarded = await knowledge.discardDrafts('ops', 'known-issues/pipelines.md');
  assert.deepEqual(discarded.discarded, ['known-issues/pipelines.md']);
  assert.doesNotMatch(await fs.readFile(path.join(dir, 'known-issues', 'pipelines.md'), 'utf8'), /Expired token/);
  assert.deepEqual(await knowledge.listDrafts('ops'), []);
});

test('closing a ticket tells the agent to run the lesson check; the tools save drafts for the task', { skip: !hasGit && 'git is not installed' }, async () => {
  const { knowledge } = await setup();
  const ops = new FileOperationsStore(path.join(tmp, `ops-${counter}`)); await ops.init();
  const taskStore = new FileTaskStore(path.join(tmp, `tasks-${counter}`)); await taskStore.init();
  const operationsService = new OperationsService({ store: ops });
  await ops.createTicket({ projectId: 'pilot', ticketId: 'OPS-20', title: 'finance_daily failed', status: 'open', priority: 'high', activity: [], source: 'manual', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), visibility: 'operators' });
  const server = createAppTools({ operationsService, taskStore, knowledgeDir: knowledge.workspace.knowledgeDir, knowledgeDrafts: knowledge.drafts, agentName: 'Sonic' })({ id: 'T-20', projectId: 'pilot', createdBy: reviewer }, fakeMcpSdk);
  const names = server.tools.map(item => item.name);
  assert.ok(names.includes('knowledge_catalog') && names.includes('update_knowledge'));

  const moved = await server.call('set_ticket_status', { ticketId: 'OPS-20', status: 'in_progress', reason: 'Starting work.' });
  assert.equal(moved.next, undefined, 'no lesson check until the ticket is closed');
  const closed = await server.call('set_ticket_status', { ticketId: 'OPS-20', status: 'resolved', resolution: 'Rerun after the schema fix; verified.', reason: 'Work verified.' });
  assert.match(closed.next, /lesson capture/);

  const catalog = await server.call('knowledge_catalog', {});
  assert.equal(catalog.bases[0].base, 'ops');
  const saved = await server.call('update_knowledge', { decision: 'append', base: 'ops', path: 'known-issues/pipelines.md', section: 'Schema change', content: 'Seen again on finance_daily.', placementReason: 'Same cause as "Schema change".', checked: ['ops/known-issues/pipelines.md'], sourceTicket: 'OPS-20', reason: 'Record where this failure recurred.' });
  assert.equal(saved.saved, true);
  const [draft] = await knowledge.listDrafts('ops');
  assert.equal(draft.taskId, 'T-20');
  const search = await server.call('search_knowledge', { query: 'finance_daily schema' });
  assert.equal(search.results[0].draft, true, 'a page with a draft section is flagged as a lead');
});

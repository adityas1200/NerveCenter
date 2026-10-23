import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { libraryRoutes } from '../src/api/library-routes.mjs';
import { createWorkspace } from '../src/workspace/workspace.mjs';
import { createSecretStore } from '../src/secrets/secret-store.mjs';
import { KnowledgeService } from '../src/knowledge/knowledge-service.mjs';
import { hasGit, makeRuntime, sdkInit, sdkResult, tempDir, wait, pilot } from './helpers.mjs';
import { serveRoutes } from './knowledge-harness.mjs';

// SPEC-knowledge-05: teach moments. What a person tells Sonic is saved as a draft that says where it came from and who said it.

const tmp = await tempDir('nc-knowledge-teach-', { maxRetries: 3 });
const skipGit = !hasGit && 'git is not installed';
let counter = 0;

async function setup() {
  counter += 1;
  const workspace = await createWorkspace({ dir: path.join(tmp, `ws-${counter}`) });
  const knowledge = new KnowledgeService({ workspace, secretStore: createSecretStore() });
  const dir = path.join(workspace.knowledgeDir, 'ops');
  await fs.mkdir(path.join(dir, 'business'), { recursive: true });
  await fs.writeFile(path.join(dir, 'index.md'), '---\ntype: Index\ntitle: Ops\ndescription: How the team works.\n---\n# Ops\n', 'utf8');
  await fs.writeFile(path.join(dir, 'business', 'requesters.md'), '---\ntype: Concept\ntitle: Requesters\nstatus: stable\n---\n# Requesters\n\n## VPs\n\nAnswer the same day.\n', 'utf8');
  await workspace.writeKnowledgeIndex();
  return { workspace, knowledge, dir };
}

test('FR-2 origin and taughtBy are checked: known origins only, taughtBy only for a person', { skip: skipGit }, async () => {
  const { knowledge } = await setup();
  const base = { decision: 'create', base: 'ops', title: 'X', content: 'x', placementReason: 'x y z', checked: [] };
  await assert.rejects(knowledge.drafts.write({ ...base, path: 'a.md', origin: 'gossip' }), /origin must be one of lesson, correction, interview, document, pass, eval/);
  await assert.rejects(knowledge.drafts.write({ ...base, path: 'b.md', origin: 'lesson', taughtBy: 'Ana' }), /use it only with origin correction or interview/);
  await assert.rejects(knowledge.drafts.write({ ...base, path: 'c.md', taughtBy: 'Ana' }), /use it only with origin correction or interview/);
});

test('FR-2 FR-3 a correction is saved with its origin in the page, the marker and the drafts API', { skip: skipGit }, async () => {
  const { knowledge, dir } = await setup();
  const created = await knowledge.drafts.write({ decision: 'create', base: 'ops', path: 'business/sla.md', title: 'Brand X SLA', content: 'Brand X refreshes by 07:00 ET.', fields: { sla: '07:00 ET' }, origin: 'correction', taughtBy: 'Priya Rao', placementReason: 'New SLA.', checked: [] }, { taskId: 'T-9' });
  assert.equal(created.origin, 'correction'); assert.equal(created.taughtBy, 'Priya Rao');
  assert.match(await fs.readFile(path.join(dir, 'business', 'sla.md'), 'utf8'), /\norigin: correction\n/);
  const appended = await knowledge.drafts.write({ decision: 'append', base: 'ops', path: 'business/requesters.md', section: 'VPs', content: 'VP asks skip the queue.', origin: 'correction', taughtBy: 'Priya Rao', placementReason: 'Same section.', checked: [] }, { taskId: 'T-9' });
  assert.equal(appended.saved, true);
  assert.match(await fs.readFile(path.join(dir, 'business', 'requesters.md'), 'utf8'), /<!-- draft source=T-9 origin=correction by=Priya-Rao updated=\d{4}-\d{2}-\d{2} -->/);
  await knowledge.drafts.write({ decision: 'create', base: 'ops', path: 'business/plain.md', title: 'Plain', content: 'A lesson.', placementReason: 'x y z', checked: [] }, { taskId: 'T-10' });
  assert.doesNotMatch(await fs.readFile(path.join(dir, 'business', 'plain.md'), 'utf8'), /origin:/, 'a plain lesson keeps the old shape');

  const server = await serveRoutes(libraryRoutes({ knowledge }));
  try {
    const { status, body } = await server.call('GET', '/api/knowledge/ops/drafts', { userId: 'viewer' });
    assert.equal(status, 200);
    const byPath = Object.fromEntries(body.items.map(item => [item.path, item]));
    assert.deepEqual([byPath['business/sla.md'].origin, byPath['business/sla.md'].taughtBy], ['correction', 'Priya Rao']);
    assert.deepEqual([byPath['business/requesters.md'].origin, byPath['business/requesters.md'].taughtBy], ['correction', 'Priya Rao']);
    assert.deepEqual([byPath['business/plain.md'].origin, byPath['business/plain.md'].taughtBy], ['lesson', null]);
  } finally { await server.close(); }
});

test('FR-3 drafts saved before origins existed read as origin null', { skip: skipGit }, async () => {
  const { knowledge, dir } = await setup();
  await knowledge.drafts.write({ decision: 'create', base: 'ops', path: 'old.md', title: 'Old', content: 'Old lesson.', placementReason: 'x y z', checked: [] });
  const metaFile = path.join(path.dirname(dir), '.drafts.json');
  const meta = JSON.parse(await fs.readFile(metaFile, 'utf8'));
  for (const records of Object.values(meta)) for (const record of records) { delete record.origin; delete record.taughtBy; }
  await fs.writeFile(metaFile, JSON.stringify(meta), 'utf8');
  const [draft] = await knowledge.listDrafts('ops');
  assert.equal(draft.origin, null); assert.equal(draft.taughtBy, null);
});

test('FR-1 a task with the app tools is told to save corrections with origin correction and taughtBy', async () => {
  const calls = [];
  const sdk = { createSdkMcpServer: () => ({}), query: ({ options }) => { calls.push(options); return (async function* () { yield sdkInit('s-1'); yield sdkResult('s-1', 'Done.'); })(); } };
  const { runtime, store } = await makeRuntime(tmp, sdk, { name: 'prompt', appTools: async () => ({}) });
  const task = await runtime.startTask({ scope: pilot, prompt: 'hello', user: { id: 'mitesh', name: 'Mitesh' }, notify: false });
  await wait(async () => (await store.getTask(task.id)).status === 'done');
  const append = calls[0].systemPrompt.append;
  assert.match(append, /When the person corrects you or teaches you something reusable/);
  assert.match(append, /origin "correction" and taughtBy their name/);
  assert.match(append, /"Saved for review" card/);
});

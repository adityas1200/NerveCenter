import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { libraryRoutes } from '../src/api/library-routes.mjs';
import { createWorkspace } from '../src/workspace/workspace.mjs';
import { createSecretStore } from '../src/secrets/secret-store.mjs';
import { KnowledgeService } from '../src/knowledge/knowledge-service.mjs';
import { readFrontmatter } from '../src/knowledge/knowledge-drafts.mjs';
import { cleanFields, mergeFields, pageKey } from '../src/knowledge/knowledge-links.mjs';
import { FileTaskStore } from '../src/tasks/task-store.mjs';
import { createAppTools } from '../src/tasks/nervecenter-tools.mjs';
import { fakeMcpSdk, hasGit, tempDir } from './helpers.mjs';
import { serveRoutes } from './knowledge-harness.mjs';

// SPEC-knowledge-04: typed links between knowledge pages, the filtered catalog, fields on update_knowledge, the map.

const tmp = await tempDir('nc-knowledge-links-', { maxRetries: 3 });
const skipGit = !hasGit && 'git is not installed';
let counter = 0;
const write = async (file, text) => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, text, 'utf8'); };

/** A base with a brand, a stakeholder, two pipelines and a stale runbook. */
async function setup() {
  counter += 1;
  const workspace = await createWorkspace({ dir: path.join(tmp, `ws-${counter}`) });
  const knowledge = new KnowledgeService({ workspace, secretStore: createSecretStore() });
  const dir = path.join(workspace.knowledgeDir, 'helixa');
  await write(path.join(dir, 'index.md'), '---\ntype: Index\ntitle: Helixa\ndescription: Helixa Pharma data operations.\n---\n# Helixa\n');
  await write(path.join(dir, 'business', 'brands', 'brand-x.md'), '---\ntype: Brand\ntitle: Brand X\nmarkets: [US, DE]\nstakeholders: [business/stakeholders/jane-doe]\n---\n# Brand X\n');
  await write(path.join(dir, 'business', 'stakeholders', 'jane-doe.md'), '---\ntype: Stakeholder\ntitle: Jane Doe\ntier: VP\nresponse: same day\n---\n# Jane Doe\n');
  await write(path.join(dir, 'pipelines', 'sales-daily.md'), '---\ntype: Pipeline\ntitle: Sales daily\nbrands:\n  - business/brands/brand-x.md\nupstream: [IQVIA feed]\nsla: "07:00 ET"\nowner: Ravi\n---\n# Sales daily\n');
  await write(path.join(dir, 'pipelines', 'claims-weekly.md'), '---\ntype: Pipeline\ntitle: Claims weekly\nbrands: [Brand Y]\n---\n# Claims weekly\n');
  await write(path.join(dir, 'runbooks', 'old.md'), '---\ntype: Playbook\ntitle: Old runbook\nstale_after: 2020-01-01\nstatus: stable\n---\n# Old runbook\n');
  await write(path.join(dir, 'runbooks', 'broken.md'), '---\ntitle: [unclosed\ntype: Playbook\n---\n# Broken\n');
  await workspace.writeKnowledgeIndex();
  return { workspace, knowledge, dir };
}

test('FR-1 FR-7 fields: only known keys, bounded, lists de-duplicated, scalars one value', () => {
  assert.equal(cleanFields(undefined), null);
  assert.deepEqual(cleanFields({ brands: ['a', 'a', 'b'], sla: ' 07:00 ' }), { brands: ['a', 'b'], sla: '07:00' });
  assert.deepEqual(cleanFields({ vendor: 'IQVIA' }), { vendor: ['IQVIA'] });
  assert.throws(() => cleanFields({ colour: 'red' }), /Unknown field colour\. Link fields: upstream/);
  assert.throws(() => cleanFields({ sla: ['a', 'b'] }), /sla takes one value/);
  assert.throws(() => cleanFields({ brands: Array.from({ length: 21 }, (_, i) => `b${i}`) }), /at most 20 values/);
  assert.throws(() => cleanFields(Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`x${i}`, 'y']))), /at most 15 fields/);
  assert.equal(pageKey('./Business\\Brands/Brand-X.md'), 'business/brands/brand-x');
});

test('FR-9 merging fields unions lists, sets scalars and replaces block lists in place', () => {
  const page = '---\ntitle: Sales daily\nbrands:\n  - brand-x\nsla: 06:00\n---\n# Sales daily\n\nBody.\n';
  const merged = mergeFields(page, readFrontmatter(page).data, { brands: ['brand-y', 'brand-x'], sla: '07:00', vendor: ['IQVIA'] });
  const { data, body } = readFrontmatter(merged);
  assert.deepEqual(data.brands, ['brand-x', 'brand-y']);
  assert.equal(String(data.sla), '07:00');
  assert.deepEqual(data.vendor, ['IQVIA']);
  assert.match(body, /# Sales daily\n\nBody\./);
  const bare = mergeFields('# Plain\n', {}, { tier: 'VP' });
  assert.match(bare, /^---\ntier: VP\n---\n\n# Plain/);
});

test('FR-3 FR-4 FR-5 the catalog carries links, fields, stale and backlinks; bad YAML still reads', async () => {
  const { knowledge } = await setup();
  const base = (await knowledge.drafts.catalog({ base: 'helixa' })).bases[0];
  const sales = base.pages.find(page => page.path === 'pipelines/sales-daily.md');
  assert.deepEqual(sales.links, { upstream: ['IQVIA feed'], brands: ['business/brands/brand-x.md'], owner: ['Ravi'] });
  assert.deepEqual(sales.fields, { sla: '07:00 ET' });
  const brand = base.pages.find(page => page.path === 'business/brands/brand-x.md');
  assert.deepEqual(brand.backlinks, ['pipelines/sales-daily.md']);
  const jane = base.pages.find(page => page.path === 'business/stakeholders/jane-doe.md');
  assert.deepEqual(jane.backlinks, ['business/brands/brand-x.md']);
  assert.deepEqual(jane.fields, { tier: 'VP', response: 'same day' });
  const old = base.pages.find(page => page.path === 'runbooks/old.md');
  assert.equal(old.stale, true); assert.equal(old.staleAfter, '2020-01-01');
  assert.ok(base.pages.find(page => page.path === 'runbooks/broken.md'), 'a page with broken YAML is still listed');
});

test('FR-6 the catalog filters by type, field and value, linksTo and stale', async () => {
  const { knowledge } = await setup();
  const paths = async filter => (await knowledge.drafts.catalog({ base: 'helixa', ...filter })).bases[0].pages.map(page => page.path);
  assert.deepEqual(await paths({ type: 'pipeline' }), ['pipelines/claims-weekly.md', 'pipelines/sales-daily.md']);
  assert.deepEqual(await paths({ field: 'brands', value: 'business/brands/brand-x' }), ['pipelines/sales-daily.md'], 'a page value matches with or without .md');
  assert.deepEqual(await paths({ field: 'brands', value: 'brand y' }), ['pipelines/claims-weekly.md'], 'plain text matches case-insensitively');
  assert.deepEqual(await paths({ field: 'tier', value: 'VP' }), ['business/stakeholders/jane-doe.md']);
  assert.deepEqual(await paths({ linksTo: 'business/stakeholders/jane-doe.md' }), ['business/brands/brand-x.md']);
  assert.deepEqual(await paths({ stale: true }), ['runbooks/old.md']);
  const echoed = await knowledge.drafts.catalog({ base: 'helixa', type: 'Brand' });
  assert.deepEqual(echoed.filter, { type: 'Brand' });
  await assert.rejects(knowledge.drafts.catalog({ field: 'brands' }), /Give value with field/);
});

test('FR-7 FR-8 FR-9 update_knowledge writes fields on create and merges them on append, as drafts', { skip: skipGit }, async () => {
  const { knowledge, dir } = await setup();
  const taskStore = new FileTaskStore(path.join(tmp, `tasks-${counter}`)); await taskStore.init();
  const server = createAppTools({ operationsService: {}, taskStore, knowledgeDir: knowledge.workspace.knowledgeDir, knowledgeDrafts: knowledge.drafts, agentName: 'Sonic' })({ id: 'T-1', projectId: 'pilot', createdBy: { id: 'owner', name: 'Owner' } }, fakeMcpSdk);
  const created = await server.call('update_knowledge', { decision: 'create', base: 'helixa', path: 'pipelines/rx-weekly.md', title: 'Rx weekly', type: 'Pipeline', content: 'Loads weekly Rx.', fields: { brands: ['business/brands/brand-x'], sla: 'Mon 09:00', owner: 'Ravi' }, owner: 'Ignored', placementReason: 'New pipeline page.', checked: [], reason: 'Record the new pipeline.' });
  assert.equal(created.saved, true); assert.deepEqual(created.fields, { brands: ['business/brands/brand-x'], sla: 'Mon 09:00', owner: ['Ravi'] });
  const { data } = readFrontmatter(await fs.readFile(path.join(dir, 'pipelines', 'rx-weekly.md'), 'utf8'));
  assert.deepEqual(data.brands, ['business/brands/brand-x']); assert.equal(data.sla, 'Mon 09:00'); assert.deepEqual(data.owner, ['Ravi']); assert.equal(data.status, 'draft');

  const appended = await server.call('update_knowledge', { decision: 'append', base: 'helixa', path: 'pipelines/claims-weekly.md', fields: { brands: ['Brand Z'], sla: '08:00' }, placementReason: 'Claims also serves Brand Z.', checked: ['helixa/pipelines/claims-weekly.md'], reason: 'Record the extra brand.' });
  assert.equal(appended.saved, true); assert.match(appended.title, /Fields on pipelines\/claims-weekly\.md: brands, sla/);
  const merged = readFrontmatter(await fs.readFile(path.join(dir, 'pipelines', 'claims-weekly.md'), 'utf8')).data;
  assert.deepEqual(merged.brands, ['Brand Y', 'Brand Z']); assert.equal(merged.sla, '08:00');
  const drafts = await knowledge.listDrafts('helixa');
  assert.deepEqual(drafts.map(item => item.path).sort(), ['pipelines/claims-weekly.md', 'pipelines/rx-weekly.md']);

  const errorOf = async args => (await server.tools.find(item => item.name === 'update_knowledge').handler(args)).content[0].text;
  const same = await errorOf( { decision: 'append', base: 'helixa', path: 'pipelines/claims-weekly.md', fields: { brands: ['Brand Z'] }, placementReason: 'Again.', checked: [], reason: 'Again.' });
  assert.match(same, /already has these fields/);
  const unknown = await errorOf( { decision: 'append', base: 'helixa', path: 'pipelines/claims-weekly.md', fields: { colour: 'red' }, placementReason: 'x y z', checked: [], reason: 'Bad field.' });
  assert.match(unknown, /Unknown field colour/);
  const secret = await errorOf( { decision: 'append', base: 'helixa', path: 'pipelines/claims-weekly.md', fields: { refs: ['token = dapi0123456789abcdef0123456789abcdef'] }, placementReason: 'x y z', checked: [], reason: 'Secret.' });
  assert.match(secret, /credential/);

  const filtered = await server.call('knowledge_catalog', { base: 'helixa', field: 'brands', value: 'business/brands/brand-x.md' });
  assert.deepEqual(filtered.bases[0].pages.map(page => page.path), ['pipelines/rx-weekly.md', 'pipelines/sales-daily.md']);
});

test('FR-10 GET /api/knowledge/:name/map returns nodes, resolved links, shelves and totals; 404 for a missing base', async () => {
  const { knowledge } = await setup();
  const server = await serveRoutes(libraryRoutes({ knowledge }));
  try {
    const { status, body } = await server.call('GET', '/api/knowledge/helixa/map', { userId: 'viewer' });
    assert.equal(status, 200);
    assert.equal(body.base, 'helixa'); assert.equal(body.title, 'Helixa');
    assert.ok(!body.pages.some(page => page.path === 'index.md'), 'the index is not a node');
    const sales = body.pages.find(page => page.path === 'pipelines/sales-daily.md');
    assert.equal(sales.shelf, 'pipelines'); assert.equal(sales.status, 'kept'); assert.equal(sales.type, 'Pipeline');
    assert.deepEqual(sales.links.find(link => link.field === 'brands'), { field: 'brands', target: 'business/brands/brand-x.md', page: 'business/brands/brand-x.md' });
    assert.deepEqual(sales.links.find(link => link.field === 'upstream'), { field: 'upstream', target: 'IQVIA feed', page: null });
    assert.deepEqual(body.shelves.map(shelf => [shelf.name, shelf.pages, shelf.stale]), [['business', 2, 0], ['pipelines', 2, 0], ['runbooks', 2, 1]]);
    assert.deepEqual(body.totals, { pages: 6, kept: 6, drafts: 0, stale: 1, links: 2, orphans: 3 });
    assert.equal(body.truncated, false);
    assert.equal((await server.call('GET', '/api/knowledge/nope/map')).status, 404);
  } finally { await server.close(); }
});

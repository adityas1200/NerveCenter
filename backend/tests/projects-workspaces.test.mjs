import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { WorkspaceRegistry, Workspace, asRegistry } from '../src/workspace/workspace.mjs';
import { migrateWorkspaceLayout, shareAdminContent, migrateConnectorSecretRefs, MIGRATED_MARKER } from '../src/projects/project-migration.mjs';
import { GrantService } from '../src/projects/grant-service.mjs';
import { WorkspaceSyncSet } from '../src/workspace/workspace-sync.mjs';
import { KnowledgeService } from '../src/knowledge/knowledge-service.mjs';
import { SkillService } from '../src/skills/skill-service.mjs';
import { ConnectorService, Connectors, connectorSecretRef, connectorSecretNames } from '../src/connectors/connector-service.mjs';
import { Routines } from '../src/routines/routine-scheduler.mjs';
import { createSecretStore } from '../src/secrets/secret-store.mjs';
import { createProjectStore } from '../src/projects/project-store.mjs';
import { systemScope } from '../src/projects/project-access.mjs';
import { tempDir } from './helpers.mjs';

// SPEC-projects-01 phase 2, step 1: a workspace folder per project, the shared library and its grant links, the PILOT folder
// migration, the per-project S3 layout and project-qualified connector secrets.

const tmp = await tempDir('nc-project-ws-');
const quiet = { log() {}, warn() {}, error() {} };
let counter = 0;
const fresh = name => path.join(tmp, `${name}-${(counter += 1)}`);
const read = file => fs.readFile(file, 'utf8');
const exists = file => fs.access(file).then(() => true, () => false);
const isLink = file => fs.lstat(file).then(stat => stat.isSymbolicLink(), () => false);

test('FR-19, FR-20: each project gets its own seeded workspace folder, built once, with its own write queue', async () => {
  const root = fresh('registry');
  const registry = new WorkspaceRegistry({ root });
  const alpha = await registry.for('alpha');
  const beta = await registry.for(systemScope('beta'));
  assert.equal(alpha.dir, path.join(root, 'projects', 'alpha'));
  assert.equal(beta.dir, path.join(root, 'projects', 'beta'));
  assert.equal(alpha.projectId, 'alpha');
  assert.equal(await registry.for('alpha'), alpha, 'one instance per project');
  for (const entry of ['operations.yaml', '.mcp.json', 'CLAUDE.md', 'knowledge', '.claude/skills', 'workflows', 'tasks', 'templates']) assert.ok(await exists(path.join(alpha.dir, entry)), `${entry} is seeded`);
  assert.match(await read(path.join(alpha.dir, 'operations.yaml')), /default_write/, 'the policy defaults are seeded like a first start');
  await alpha.setSection('team', { name: 'Alpha team', timezone: 'UTC' });
  assert.equal((await alpha.readOperations()).team.name, 'Alpha team');
  assert.notEqual((await beta.readOperations()).team?.name, 'Alpha team', 'a change in one project is not in another');
  assert.notEqual(alpha.queue, beta.queue, 'each instance keeps its own write queue');
  assert.equal(await exists(path.join(root, 'operations.yaml')), false, 'nothing is written to the workspace root');
});

test('FR-19: the Unrouted queue and the All view have no workspace; a malformed id is refused', async () => {
  const registry = new WorkspaceRegistry({ root: fresh('refused') });
  await assert.rejects(registry.for('unrouted'), error => error.statusCode === 403);
  await assert.rejects(registry.for({ projectId: 'ALL', all: true }), error => error.statusCode === 403);
  await assert.rejects(registry.for('../escape'), error => error.statusCode === 403);
  await assert.rejects(registry.for(undefined), error => error.statusCode === 403);
});

test('a lone Workspace still works wherever a registry is expected (one fixed folder for every project)', async () => {
  const workspace = await new Workspace({ dir: fresh('fixed') }).init();
  const registry = asRegistry(workspace);
  assert.equal(await registry.for('alpha'), workspace);
  assert.equal(await registry.for('beta'), workspace);
  assert.equal(asRegistry(registry), registry);
});

/** A workspace as it was before projects: everything directly in the root. */
async function legacyWorkspace(root) {
  const write = async (file, text) => { await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true }); await fs.writeFile(path.join(root, file), text); };
  await write('operations.yaml', 'team:\n  name: Old team\n  timezone: UTC\n');
  await write('.mcp.json', '{"mcpServers":{}}');
  await write('CLAUDE.md', '# Old\n');
  await write('workflows/daily.yaml', 'objective: x\ntrigger: {type: manual}\n');
  await write('tasks/T-1001/report.md', '# Old task\n');
  await write('templates/word/t.docx', 'docx');
  await write('knowledge/runbooks/index.md', '---\ntitle: Runbooks\n---\n# Runbooks\n');
  await write('knowledge/runbooks/.git/HEAD', 'ref: refs/heads/main\n');
  await write('knowledge/team-knowledge/index.md', '# Team knowledge\n');
  await write('knowledge/.bases.json', JSON.stringify({ runbooks: { kind: 'git', url: 'https://example.com/r.git', title: 'Runbooks' } }));
  await write('knowledge/.drafts.json', JSON.stringify({ 'runbooks/a.md': [{ title: 'A' }], 'team-knowledge/b.md': [{ title: 'B' }] }));
  await write('knowledge-uploads/runbooks/doc.md', 'doc');
  await write('.claude/skills/triage/SKILL.md', '---\nname: triage\n---\n# Triage\n');
}

test('FR-42: the old workspace moves into projects/pilot, admin-added bases and skills move to the library with links back', async () => {
  const root = fresh('migrate'); await legacyWorkspace(root);
  const result = await migrateWorkspaceLayout({ root, log: quiet });
  assert.ok(result.moved.includes('operations.yaml') && result.moved.includes('tasks'));
  const pilot = path.join(root, 'projects', 'pilot');
  assert.equal(await read(path.join(pilot, 'operations.yaml')), 'team:\n  name: Old team\n  timezone: UTC\n');
  assert.equal(await read(path.join(pilot, 'tasks', 'T-1001', 'report.md')), '# Old task\n');
  for (const item of ['operations.yaml', '.mcp.json', 'CLAUDE.md', 'workflows', 'tasks', 'templates', 'knowledge', '.claude']) assert.equal(await exists(path.join(root, item)), false, `${item} left the root`);
  assert.ok(await exists(path.join(root, MIGRATED_MARKER)));

  // The Git base: canonical copy in the library with its .git, a relative link in PILOT's knowledge folder, its records split out.
  assert.deepEqual(result.bases, ['runbooks']); assert.deepEqual(result.skills, ['triage']);
  assert.ok(await exists(path.join(root, 'library', 'knowledge', 'runbooks', '.git', 'HEAD')), '.git is preserved');
  assert.ok(await isLink(path.join(pilot, 'knowledge', 'runbooks')));
  assert.equal(await fs.readlink(path.join(pilot, 'knowledge', 'runbooks')), path.join('..', '..', '..', 'library', 'knowledge', 'runbooks'), 'a relative link');
  assert.match(await read(path.join(pilot, 'knowledge', 'runbooks', 'index.md')), /Runbooks/);
  assert.deepEqual(Object.keys(JSON.parse(await read(path.join(root, 'library', 'knowledge', '.bases.json')))), ['runbooks']);
  assert.deepEqual(Object.keys(JSON.parse(await read(path.join(pilot, 'knowledge', '.bases.json')))), []);
  assert.deepEqual(Object.keys(JSON.parse(await read(path.join(root, 'library', 'knowledge', '.drafts.json')))), ['runbooks/a.md']);
  assert.deepEqual(Object.keys(JSON.parse(await read(path.join(pilot, 'knowledge', '.drafts.json')))), ['team-knowledge/b.md']);
  assert.ok(await exists(path.join(root, 'library', 'knowledge-uploads', 'runbooks', 'doc.md')), 'uploaded documents follow their base');
  // The project's own lessons base stays in the project; the skill is shared.
  assert.equal(await isLink(path.join(pilot, 'knowledge', 'team-knowledge')), false);
  assert.ok(await exists(path.join(pilot, 'knowledge', 'team-knowledge', 'index.md')));
  assert.ok(await isLink(path.join(pilot, '.claude', 'skills', 'triage')));
  assert.ok(await exists(path.join(root, 'library', 'skills', 'triage', 'SKILL.md')));
});

test('FR-42: the migration is idempotent and finishes a run that stopped half way', async () => {
  const root = fresh('crash'); await legacyWorkspace(root);
  // A crash after two renames: two items are already in PILOT's folder, the rest is still in the root, no marker.
  await fs.mkdir(path.join(root, 'projects', 'pilot'), { recursive: true });
  await fs.rename(path.join(root, 'operations.yaml'), path.join(root, 'projects', 'pilot', 'operations.yaml'));
  await fs.rename(path.join(root, 'tasks'), path.join(root, 'projects', 'pilot', 'tasks'));
  const resumed = await migrateWorkspaceLayout({ root, log: quiet });
  assert.deepEqual(resumed.conflicts, []);
  assert.ok(await exists(path.join(root, 'projects', 'pilot', 'workflows', 'daily.yaml')));
  assert.ok(await isLink(path.join(root, 'projects', 'pilot', 'knowledge', 'runbooks')));
  const before = await read(path.join(root, 'library', 'knowledge', '.bases.json'));
  assert.equal((await migrateWorkspaceLayout({ root, log: quiet })).skipped, true, 'the marker makes the second run a no-op');
  assert.equal(await read(path.join(root, 'library', 'knowledge', '.bases.json')), before);
  // Sharing again (as a restore does) changes nothing.
  assert.deepEqual(await shareAdminContent({ root, log: quiet }), { bases: [], skills: ['triage'] }, 'sharing again moves nothing: the skill is only reported as already linked');
});

test('FR-42: an item that PILOT already has is left in the root and reported, never overwritten', async () => {
  const root = fresh('conflict'); await legacyWorkspace(root);
  await fs.mkdir(path.join(root, 'projects', 'pilot'), { recursive: true });
  await fs.writeFile(path.join(root, 'projects', 'pilot', 'CLAUDE.md'), '# New\n');
  const result = await migrateWorkspaceLayout({ root, log: quiet });
  assert.deepEqual(result.conflicts, ['CLAUDE.md']);
  assert.equal(await read(path.join(root, 'projects', 'pilot', 'CLAUDE.md')), '# New\n');
  assert.equal(await read(path.join(root, 'CLAUDE.md')), '# Old\n');
});

test('FR-42: a fresh install has nothing to move and just records the marker', async () => {
  const root = fresh('fresh');
  const result = await migrateWorkspaceLayout({ root, log: quiet });
  assert.deepEqual(result.moved, []); assert.ok(await exists(path.join(root, MIGRATED_MARKER)));
});

test('FR-31: grant links follow the grants, a project folder of the same name is never replaced, and a link cannot read outside its base', async () => {
  const root = fresh('links');
  const registry = new WorkspaceRegistry({ root });
  const library = await registry.library();
  await fs.mkdir(path.join(library.knowledgeDir, 'shared-runbooks'), { recursive: true });
  await fs.writeFile(path.join(library.knowledgeDir, 'shared-runbooks', 'index.md'), '---\ntitle: Shared runbooks\ndescription: For everyone\n---\n# Shared\n');
  await fs.mkdir(path.join(library.skillsDir, 'rca-plus'), { recursive: true });
  await fs.writeFile(path.join(library.skillsDir, 'rca-plus', 'SKILL.md'), '---\nname: rca-plus\ndescription: Deeper RCA\n---\n# RCA plus\n');
  const alpha = await registry.for('alpha'); const beta = await registry.for('beta');

  const linked = await alpha.applyLibraryGrants({ knowledge: ['shared-runbooks'], skills: ['rca-plus'] });
  assert.deepEqual(linked.linked.sort(), ['knowledge/shared-runbooks', 'skills/rca-plus']);
  assert.ok(await isLink(path.join(alpha.knowledgeDir, 'shared-runbooks')));
  const folders = await alpha.listKnowledgeFolders();
  assert.deepEqual(folders.map(item => [item.name, item.shared, item.title]), [['shared-runbooks', true, 'Shared runbooks']]);
  assert.deepEqual((await alpha.listCustomSkills()).map(item => [item.name, item.shared]), [['rca-plus', true]]);
  assert.deepEqual(await beta.listKnowledgeFolders(), [], 'a project that was not granted sees nothing');
  assert.equal((await alpha.readFile(alpha.knowledgePath('shared-runbooks'), 'index.md')).content.includes('Shared'), true);

  // A link inside a base that points out of it is not followed.
  await fs.writeFile(path.join(root, 'secret.txt'), 'top secret');
  await fs.symlink(path.join(root, 'secret.txt'), path.join(library.knowledgeDir, 'shared-runbooks', 'leak.md'));
  await assert.rejects(alpha.readFile(alpha.knowledgePath('shared-runbooks'), 'leak.md'), /escapes/);

  // Removing the grant removes the link and nothing else; the library keeps its copy.
  const removed = await alpha.applyLibraryGrants({ knowledge: [], skills: ['rca-plus'] });
  assert.deepEqual(removed.removed, ['knowledge/shared-runbooks']);
  assert.equal(await exists(path.join(alpha.knowledgeDir, 'shared-runbooks')), false);
  assert.ok(await exists(path.join(library.knowledgeDir, 'shared-runbooks', 'index.md')));

  // A folder the project made itself with the same name wins: the grant is a collision, not an overwrite.
  await fs.mkdir(path.join(beta.knowledgeDir, 'shared-runbooks'), { recursive: true });
  await fs.writeFile(path.join(beta.knowledgeDir, 'shared-runbooks', 'mine.md'), 'mine');
  const clash = await beta.applyLibraryGrants({ knowledge: ['shared-runbooks'] });
  assert.deepEqual(clash.collisions, ['knowledge/shared-runbooks']);
  assert.equal(await read(path.join(beta.knowledgeDir, 'shared-runbooks', 'mine.md')), 'mine');
  await assert.rejects(beta.linkLibraryEntry('knowledge', 'shared-runbooks'), error => error.statusCode === 409);
  // and the grant removal leaves that folder alone
  assert.deepEqual((await beta.applyLibraryGrants({ knowledge: [] })).removed, []);
});

test('FR-31: the grant service reconciles links from the grants, and records the links the migration left as PILOT grants once', async () => {
  const root = fresh('grant-service'); await legacyWorkspace(root); await migrateWorkspaceLayout({ root, log: quiet });
  const registry = new WorkspaceRegistry({ root });
  const projects = await memoryProjects();
  await registry.for('pilot');
  const grants = new GrantService({ projects, workspaces: registry, log: quiet });
  assert.deepEqual((await grants.grantExistingLinks('pilot')).sort(), ['knowledge/runbooks', 'skill/triage']);
  assert.deepEqual(await grants.grantExistingLinks('pilot'), [], 'recorded once');
  // The admin removes the skill grant: its link goes, and starting again does not bring the grant back.
  await projects.removeGrant('pilot', 'skill', 'triage', { id: 'admin' });
  const pilot = await registry.for('pilot');
  assert.deepEqual((await grants.reconcileLinks('pilot')).removed, ['skills/triage']);
  assert.equal(await exists(path.join(pilot.skillsDir, 'triage')), false);
  assert.deepEqual(await grants.grantExistingLinks('pilot'), []);
  // A grant for a new project is linked at the next reconcile.
  await projects.create({ id: 'alpha', name: 'Alpha' }, { id: 'admin' });
  await projects.putGrant('alpha', { resourceType: 'knowledge', resourceId: 'runbooks' }, { id: 'admin' });
  const done = await grants.reconcileAll();
  assert.ok(done.find(item => item.projectId === 'alpha').linked.includes('knowledge/runbooks'));
  assert.ok(await isLink(path.join((await registry.for('alpha')).knowledgeDir, 'runbooks')));
});

/** The real file-backed project store in a scratch folder, with PILOT in it. */
async function memoryProjects() {
  const { FileProjectPersistence, ProjectStore } = await import('../src/projects/project-store.mjs');
  const persistence = new FileProjectPersistence(path.join(fresh('projects-store'), 'projects.json'));
  const store = await new ProjectStore({ persistence }).init();
  await store.create({ id: 'pilot', name: 'PILOT' }, { id: 'test' });
  return store;
}

function sharedKnowledge(root, { grants = [] } = {}) {
  const registry = new WorkspaceRegistry({ root });
  const secretStore = createSecretStore();
  const runtime = { started: [], startTask: async function (input) { this.started.push(input); return { id: `T-${this.started.length}` }; } };
  const make = async id => new KnowledgeService({ workspace: await registry.for(id), secretStore, runtime, library: await registry.library(), onShared: async ({ name }) => { grants.push({ id, type: 'knowledge', name }); } });
  return { registry, runtime, make, grants };
}

const doc = (name, text = `# ${name}\n\nbody\n`) => ({ name, data: Buffer.from(text).toString('base64') });

test('FR-31, FR-34, FR-35: an uploaded base lives in the library, is granted to the project that added it, is read-only, and is invisible to others', async () => {
  const root = fresh('knowledge'); const { registry, runtime, make, grants } = sharedKnowledge(root);
  const alpha = await make('alpha'); const beta = await make('beta');
  const base = await alpha.upload({ title: 'Ops Runbooks', files: [doc('SOP.md')], user: { id: 'admin', name: 'Admin' } });
  assert.equal(base.name, 'ops-runbooks'); assert.equal(base.shared, true); assert.equal(base.readOnly, true);
  assert.ok(await exists(path.join(root, 'library', 'knowledge', 'ops-runbooks', 'index.md')), 'the canonical copy is in the library');
  assert.ok(await isLink(path.join((await registry.for('alpha')).knowledgeDir, 'ops-runbooks')), 'and linked into the project');
  assert.deepEqual(grants, [{ id: 'alpha', type: 'knowledge', name: 'ops-runbooks' }], 'the grant is recorded for the project');
  assert.ok(await exists(path.join(root, 'library', 'knowledge-uploads', 'ops-runbooks', 'SOP.md')), 'uploads sit next to the base in the library');
  assert.deepEqual((await beta.list()).items, [], 'another project sees nothing');
  // The extraction task runs in the adding project and reaches the shared base by its library path.
  const [task] = runtime.started;
  assert.equal(task.scope.projectId, 'alpha'); assert.equal(task.context.sharedBase, true);
  assert.ok(task.prompt.includes(path.join(root, 'library', 'knowledge', 'ops-runbooks')));
  // A name the project already uses for its own base is refused.
  const own = await registry.for('beta'); await fs.mkdir(path.join(own.knowledgeDir, 'mine'), { recursive: true });
  await assert.rejects(beta.upload({ title: 'Mine', files: [doc('a.md')] }), error => error.statusCode === 409);
  // Deleting removes the library copy and the link.
  assert.equal(await alpha.remove('ops-runbooks'), true);
  assert.equal(await exists(path.join(root, 'library', 'knowledge', 'ops-runbooks')), false);
  assert.equal(await exists(path.join((await registry.for('alpha')).knowledgeDir, 'ops-runbooks')), false);
});

test('FR-35: lessons are saved in the project\'s own base and never in a shared one (except by the task that builds it)', async () => {
  const root = fresh('lessons'); const { registry, make } = sharedKnowledge(root);
  const alpha = await make('alpha'); const beta = await make('beta');
  await alpha.upload({ title: 'Shared base', files: [doc('a.md')] });
  const lesson = { decision: 'create', path: 'known-issues/x.md', title: 'X', content: 'Restart the job twice.', placementReason: 'new', checked: [] };
  await assert.rejects(alpha.drafts.write({ ...lesson, base: 'shared-base' }, {}), /shared knowledge base and is read-only/);
  const saved = await alpha.drafts.write(lesson, { taskId: 'T-1' });
  assert.equal(saved.base, 'team-knowledge', 'with no base given, the project gets its own');
  assert.ok(await exists(path.join((await registry.for('alpha')).knowledgeDir, 'team-knowledge', 'known-issues', 'x.md')));
  assert.deepEqual((await beta.drafts.catalog()).bases, [], 'beta sees neither the lesson nor the shared base');
  const catalog = await alpha.drafts.catalog();
  assert.deepEqual(catalog.bases.map(item => [item.base, Boolean(item.shared)]).sort(), [['shared-base', true], ['team-knowledge', false]], 'the catalog shows shared bases too, marked');
  // The build task for a shared base may write into it, through the library.
  const built = await alpha.drafts.write({ ...lesson, base: 'shared-base', path: 'p.md' }, { taskId: 'T-2', allowShared: true });
  assert.equal(built.base, 'shared-base');
  assert.ok(await exists(path.join(root, 'library', 'knowledge', 'shared-base', 'p.md')));
});

test('FR-31: an uploaded skill is stored in the library and linked into the project that added it; removing it takes both away', async () => {
  const root = fresh('skills'); const registry = new WorkspaceRegistry({ root }); const library = await registry.library();
  const recorded = [];
  const skills = new SkillService({ workspace: await registry.for('alpha'), library, onShared: async ({ name }) => recorded.push(name), onUnshare: async () => {} });
  const AdmZip = (await import('adm-zip')).default; const zip = new AdmZip(); zip.addFile('my-skill/SKILL.md', Buffer.from('---\nname: my-skill\ndescription: d\n---\n# Mine\n'));
  const uploaded = await skills.upload({ zipBase64: zip.toBuffer().toString('base64') });
  assert.equal(uploaded.id, 'custom:my-skill'); assert.equal(uploaded.shared, true);
  assert.ok(await exists(path.join(library.skillsDir, 'my-skill', 'SKILL.md')));
  assert.deepEqual(recorded, ['my-skill']);
  assert.equal((await new SkillService({ workspace: await registry.for('beta'), library }).list()).some(item => item.id === 'custom:my-skill'), false, 'not visible to a project without the grant');
  assert.equal(await skills.remove('custom:my-skill'), true);
  assert.equal(await exists(path.join(library.skillsDir, 'my-skill')), false);
});

test('FR-24: connector secrets are stored under the project, and one project never reads another\'s', async () => {
  const root = fresh('connectors'); const registry = new WorkspaceRegistry({ root }); const secretStore = createSecretStore();
  const connectors = new Connectors({ workspace: registry, secretStore });
  const alpha = await connectors.for('alpha'); const beta = await connectors.for('beta');
  await alpha.saveCustom({ kind: 'api', name: 'Billing', baseUrl: 'https://billing.example.com', auth: 'bearer', token: 'alpha-token' });
  assert.equal(await secretStore.get('projects/alpha/connectors/billing/BILLING_TOKEN'), 'alpha-token');
  assert.equal(await secretStore.get('connectors/billing/BILLING_TOKEN'), undefined, 'no global ref is written');
  assert.deepEqual(await alpha.envForTasks(), { BILLING_TOKEN: 'alpha-token' });
  assert.deepEqual(await beta.envForTasks(), {}, 'beta has no connectors and no secrets');
  assert.equal((await alpha.list()).some(card => card.id === 'billing'), true);
  assert.equal((await beta.list()).some(card => card.id === 'billing'), false, 'a connector card belongs to the project\'s operations.yaml');
  await beta.saveCustom({ kind: 'api', name: 'Billing', baseUrl: 'https://other.example.com', auth: 'bearer', token: 'beta-token' });
  assert.deepEqual(await alpha.envForTasks(), { BILLING_TOKEN: 'alpha-token' }, 'same connector name, separate secrets');
  assert.deepEqual(await beta.envForTasks(), { BILLING_TOKEN: 'beta-token' });
  await alpha.remove('billing');
  assert.equal(await secretStore.get('projects/alpha/connectors/billing/BILLING_TOKEN'), undefined);
  assert.equal(await secretStore.get('projects/beta/connectors/billing/BILLING_TOKEN'), 'beta-token');
  // A workspace with no project (one fixed folder) keeps the old global refs.
  assert.equal(connectorSecretRef('billing', 'BILLING_TOKEN'), 'connectors/billing/BILLING_TOKEN');
  assert.equal(connectorSecretRef('billing', 'BILLING_TOKEN', 'alpha'), 'projects/alpha/connectors/billing/BILLING_TOKEN');
});

test('FR-24: PILOT\'s existing global connector secrets are copied to project-qualified refs, once, keeping the old values', async () => {
  const secretStore = createSecretStore();
  await secretStore.set('connectors/github/GITHUB_TOKEN', 'gh-secret'); await secretStore.set('connectors/billing/BILLING_TOKEN', 'bill');
  const operations = { connections: { github: { kind: 'mcp', transport: 'stdio', command: 'x', env: { GITHUB_TOKEN: '${GITHUB_TOKEN}' } }, billing: { kind: 'api', base_url: 'https://b', env: { BILLING_TOKEN: '${BILLING_TOKEN}' } } } };
  const refs = connectorSecretNames(operations);
  assert.ok(refs.includes('connectors/github/GITHUB_TOKEN') && refs.includes('connectors/billing/BILLING_TOKEN'));
  assert.deepEqual(await migrateConnectorSecretRefs({ secretStore, connectorRefs: refs }), { copied: 2 });
  assert.equal(await secretStore.get('projects/pilot/connectors/github/GITHUB_TOKEN'), 'gh-secret');
  assert.equal(await secretStore.get('connectors/github/GITHUB_TOKEN'), 'gh-secret', 'the old value stays for a rollback');
  await secretStore.set('projects/pilot/connectors/billing/BILLING_TOKEN', 'changed');
  assert.deepEqual(await migrateConnectorSecretRefs({ secretStore, connectorRefs: refs }), { copied: 0 }, 'a second run copies nothing and overwrites nothing');
  assert.equal(await secretStore.get('projects/pilot/connectors/billing/BILLING_TOKEN'), 'changed');
});

/** In-memory S3, as in workspace-sync.test.mjs. */
function fakeS3() {
  const objects = new Map();
  return {
    objects,
    async send(command) {
      const name = command.constructor.name; const input = command.input;
      if (name === 'ListObjectsV2Command') { const keys = [...objects.keys()].filter(key => key.startsWith(input.Prefix)).sort(); return { Contents: keys.map(Key => ({ Key, Size: objects.get(Key).length, ETag: 'x' })), IsTruncated: false }; }
      if (name === 'GetObjectCommand') { const body = objects.get(input.Key); if (!body) throw new Error('NoSuchKey'); return { Body: { transformToByteArray: async () => body } }; }
      if (name === 'PutObjectCommand') { objects.set(input.Key, Buffer.from(input.Body)); return {}; }
      if (name === 'DeleteObjectCommand') { objects.delete(input.Key); return {}; }
      throw new Error(`Unexpected command ${name}`);
    },
  };
}

test('FR-23: S3 sync mirrors projects/<id>/ and library/ separately, with a state file per folder, and leaves grant links out', async () => {
  const root = fresh('sync-push'); const registry = new WorkspaceRegistry({ root }); const library = await registry.library();
  await fs.mkdir(path.join(library.knowledgeDir, 'shared'), { recursive: true }); await fs.writeFile(path.join(library.knowledgeDir, 'shared', 'index.md'), '# Shared\n');
  const alpha = await registry.for('alpha'); await registry.for('beta');
  await alpha.applyLibraryGrants({ knowledge: ['shared'] });
  await alpha.setSection('team', { name: 'Alpha', timezone: 'UTC' });
  await fs.mkdir(path.join(alpha.dir, 'source', 'repo'), { recursive: true }); await fs.writeFile(path.join(alpha.dir, 'source', 'repo', 'a.js'), 'mirror');
  const s3 = fakeS3(); const sync = new WorkspaceSyncSet({ root, bucket: 'b', prefix: 'nervecenter', client: s3, log: quiet });
  const pushed = await sync.push();
  assert.ok(pushed.uploaded > 0);
  const keys = [...s3.objects.keys()];
  assert.ok(keys.includes('nervecenter/workspace/projects/alpha/operations.yaml'));
  assert.ok(keys.includes('nervecenter/workspace/projects/beta/operations.yaml'));
  assert.ok(keys.includes('nervecenter/workspace/library/knowledge/shared/index.md'));
  assert.equal(keys.some(key => key.startsWith('nervecenter/workspace/projects/alpha/knowledge/shared')), false, 'a grant link is not mirrored under the project');
  assert.equal(keys.some(key => key.includes('/source/')), false, 'the source mirror is not mirrored');
  assert.equal(keys.some(key => key.endsWith('.nervecenter-sync.json')), false);
  assert.ok(await exists(path.join(alpha.dir, '.nervecenter-sync.json')), 'each folder keeps its own state');
  assert.ok(await exists(path.join(library.dir, '.nervecenter-sync.json')));
  assert.deepEqual(await sync.push(), { uploaded: 0, deleted: 0 });
  // Only alpha changed: its file reaches the bucket.
  await new Promise(resolve => setTimeout(resolve, 20));
  await alpha.setSection('team', { name: 'Alpha 2', timezone: 'UTC' });
  assert.ok((await sync.push()).uploaded >= 1);
  assert.match(s3.objects.get('nervecenter/workspace/projects/alpha/operations.yaml').toString(), /Alpha 2/);
});

test('FR-23: restore runs per project when its operations.yaml is absent, and brings back the library and projects that only the bucket has', async () => {
  const s3 = fakeS3(); const put = (key, text) => s3.objects.set(`nervecenter/workspace/${key}`, Buffer.from(text));
  put('projects/alpha/operations.yaml', 'team: {name: Alpha}\n'); put('projects/alpha/tasks/T-1/r.md', '# r\n');
  put('projects/beta/operations.yaml', 'team: {name: Beta}\n'); put('library/knowledge/shared/index.md', '# Shared\n');
  const root = fresh('sync-restore');
  // beta is already on this disk: it is not overwritten.
  await fs.mkdir(path.join(root, 'projects', 'beta'), { recursive: true }); await fs.writeFile(path.join(root, 'projects', 'beta', 'operations.yaml'), 'team: {name: Local beta}\n');
  const sync = new WorkspaceSyncSet({ root, bucket: 'b', prefix: 'nervecenter', client: s3, log: quiet });
  const result = await sync.restore();
  assert.deepEqual(result.projects, ['alpha']); assert.equal(result.library, true);
  assert.equal(await read(path.join(root, 'projects', 'alpha', 'tasks', 'T-1', 'r.md')), '# r\n');
  assert.equal(await read(path.join(root, 'projects', 'beta', 'operations.yaml')), 'team: {name: Local beta}\n');
  assert.ok(await exists(path.join(root, 'library', 'knowledge', 'shared', 'index.md')));
  assert.deepEqual(await sync.push(), { uploaded: 1, deleted: 0 }, 'only the local beta file differs from the bucket\'s state; restored files are in sync');
  assert.match((await sync.restore()).skipped, /already present/);
});

test('FR-23, FR-42: a bucket written before projects is restored into PILOT\'s folder, with admin-added bases shared', async () => {
  const s3 = fakeS3(); const put = (key, text) => s3.objects.set(`nervecenter/workspace/${key}`, Buffer.from(text));
  put('operations.yaml', 'team: {name: Old}\n'); put('tasks/T-1/r.md', '# r\n'); put('knowledge/runbooks/index.md', '# Runbooks\n');
  put('knowledge/.bases.json', JSON.stringify({ runbooks: { kind: 'upload', title: 'Runbooks' } })); put('.claude/skills/triage/SKILL.md', '---\nname: triage\n---\n');
  const root = fresh('sync-legacy');
  const sync = new WorkspaceSyncSet({ root, bucket: 'b', prefix: 'nervecenter', client: s3, log: quiet });
  const result = await sync.restore();
  assert.equal(result.legacy, 5);
  assert.equal(await read(path.join(root, 'projects', 'pilot', 'operations.yaml')), 'team: {name: Old}\n');
  assert.equal(await exists(path.join(root, 'operations.yaml')), false, 'nothing lands in the root');
  assert.ok(await isLink(path.join(root, 'projects', 'pilot', 'knowledge', 'runbooks')));
  assert.ok(await exists(path.join(root, 'library', 'knowledge', 'runbooks', 'index.md')));
  assert.ok(await exists(path.join(root, 'library', 'skills', 'triage', 'SKILL.md')));
  // The next push uploads the new layout and the old keys are left alone.
  await sync.push();
  assert.ok(s3.objects.has('nervecenter/workspace/projects/pilot/operations.yaml'));
  assert.ok(s3.objects.has('nervecenter/workspace/library/knowledge/runbooks/index.md'));
  // A second restore with PILOT present does not read the old keys again.
  assert.equal((await sync.restore()).legacy, 0);
});

test('FR-39: routines are per project: each project has its own workflows and state, and a project that fails does not stop the others', async () => {
  const root = fresh('routines'); const registry = new WorkspaceRegistry({ root }); const stateDir = fresh('routine-state');
  const started = []; const failing = new Set();
  const runtime = {
    store: { listTasks: async () => [] },
    startTask: async input => { if (failing.has(input.scope.projectId)) throw new Error('boom'); started.push(input.scope.projectId); return { id: `T-${started.length}` }; },
  };
  const projects = { list: async () => [{ id: 'alpha', kind: 'normal', archivedAt: null }, { id: 'beta', kind: 'normal', archivedAt: null }, { id: 'gamma', kind: 'normal', archivedAt: '2026-01-01' }, { id: 'unrouted', kind: 'unrouted', archivedAt: null }] };
  const routines = new Routines({ workspace: registry, runtime, projects, stateFileFor: id => path.join(stateDir, `${id}.json`), log: quiet, clock: () => new Date('2026-10-05T09:00:00Z') });
  const save = async id => (await routines.for(id)).save({ name: 'morning', objective: 'Check the pipelines each morning', schedule: { kind: 'daily', time: '09:00', timezone: 'UTC' }, permission: 'read-only' });
  for (const id of ['alpha', 'beta', 'gamma']) await save(id);
  assert.ok(await exists(path.join(root, 'projects', 'alpha', 'workflows', 'morning.yaml')));
  assert.deepEqual((await (await routines.for('delta')).list()), [], 'a project\'s routines are its own');
  const fired = await routines.tick();
  assert.deepEqual(fired.map(item => item.projectId).sort(), ['alpha', 'beta'], 'archived projects and Unrouted are skipped');
  assert.deepEqual(started.sort(), ['alpha', 'beta']);
  assert.ok(await exists(path.join(stateDir, 'alpha.json')) && await exists(path.join(stateDir, 'beta.json')), 'each project has its own state');
  // One project failing to start leaves the other untouched.
  started.length = 0; failing.add('alpha');
  const next = new Routines({ workspace: registry, runtime, projects, stateFileFor: id => path.join(stateDir, `next-${id}.json`), log: quiet, clock: () => new Date('2026-10-06T09:00:00Z') });
  assert.deepEqual((await next.tick()).map(item => item.projectId), ['beta']);
});

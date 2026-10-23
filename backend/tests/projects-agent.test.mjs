import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { FileTaskStore } from '../src/tasks/task-store.mjs';
import { TaskRuntime } from '../src/tasks/task-runtime.mjs';
import { WorkspaceRegistry } from '../src/workspace/workspace.mjs';
import { checkPathAccess } from '../src/tasks/path-guard.mjs';
import { systemScope } from '../src/projects/project-access.mjs';
import { tempDir, wait, sdkInit, sdkResult } from './helpers.mjs';

// SPEC-projects-01 phase 2, step 2: one agent per project. Its cwd is the project workspace (FR-19), old tasks continue in a
// fresh session seeded with their transcript (FR-45), and the file tools cannot leave the project (FR-46).

const tmp = await tempDir('nc-project-agent-');
const user = { id: 'u1', name: 'Alice', email: 'alice@zs.com' };
let counter = 0;

async function harness({ sdk, env } = {}) {
  const id = (counter += 1);
  const root = path.join(tmp, `root-${id}`);
  const registry = new WorkspaceRegistry({ root });
  const store = new FileTaskStore(path.join(tmp, `store-${id}`)); await store.init();
  const runtime = new TaskRuntime({ store, workspace: registry, sdkLoader: async () => sdk, env: env || (async () => ({})) });
  return { root, registry, store, runtime };
}

/** An SDK that records its options and, with `probe`, calls the permission gate with the given tool calls. */
function recordingSdk({ probe = [] } = {}) {
  const calls = []; const decisions = [];
  return {
    calls, decisions,
    query({ prompt, options }) {
      calls.push({ prompt, options }); const n = calls.length;
      return (async function* () {
        yield sdkInit(`sess-${n}`);
        for (const [tool, input] of probe) decisions.push({ tool, input, ...(await options.canUseTool(tool, input, { signal: options.abortController.signal })) });
        yield sdkResult(`sess-${n}`, `Reply ${n}`);
      })();
    },
  };
}

const finished = (store, id) => wait(async () => ['done', 'failed'].includes((await store.getTask(id)).status), 10000, 'task finished');

test('FR-19: a task runs with its project workspace as cwd and that project\'s connector environment', async () => {
  const seen = [];
  const sdk = recordingSdk();
  const { root, store, runtime } = await harness({ sdk, env: async task => { seen.push(task.projectId); return { ALPHA_ONLY: task.projectId }; } });
  const a = await runtime.startTask({ scope: systemScope('alpha'), prompt: 'Hello', user, notify: false });
  await finished(store, a.id);
  const b = await runtime.startTask({ scope: systemScope('beta'), prompt: 'Hello', user, notify: false });
  await finished(store, b.id);
  assert.equal(sdk.calls[0].options.cwd, path.join(root, 'projects', 'alpha'));
  assert.equal(sdk.calls[1].options.cwd, path.join(root, 'projects', 'beta'));
  assert.deepEqual(seen, ['alpha', 'beta']);
  assert.equal(sdk.calls[0].options.env.ALPHA_ONLY, 'alpha'); assert.equal(sdk.calls[1].options.env.ALPHA_ONLY, 'beta');
  assert.ok((await fs.stat(path.join(root, 'projects', 'alpha', 'tasks', a.id))).isDirectory(), 'task files go in the project folder');
  assert.equal((await store.getTask(a.id)).cwdLayout, 'project');
});

test('FR-45: a task from before projects continues in a fresh session seeded with its transcript, once', async () => {
  const sdk = recordingSdk();
  const { store, runtime } = await harness({ sdk });
  const task = await runtime.startTask({ scope: systemScope('pilot'), prompt: 'First question about the pipeline', user, notify: false });
  await finished(store, task.id);
  // Make it look like a task of the old layout: it has a session of the old cwd and no layout marker.
  await store.updateTask(task.id, { sessionId: 'old-session', cwdLayout: null });
  await runtime.sendMessage(task.id, user, 'And a follow-up');
  await wait(() => sdk.calls.length === 2, 10000, 'second run');
  await finished(store, task.id);
  const second = sdk.calls[1];
  assert.equal(second.options.resume, undefined, 'the old session is not resumed');
  assert.match(second.prompt, /conversation so far/);
  assert.match(second.prompt, /First question about the pipeline/);
  assert.match(second.prompt, /And a follow-up/);
  const events = await store.listEvents(task.id);
  assert.ok(events.some(event => event.title === 'Continuing in a new session'));
  assert.equal((await store.getTask(task.id)).cwdLayout, 'project');
  // From now on it resumes the new session as usual.
  await runtime.sendMessage(task.id, user, 'Third message');
  await wait(() => sdk.calls.length === 3, 10000, 'third run');
  assert.equal(sdk.calls[2].options.resume, 'sess-2');
  assert.equal((await store.listEvents(task.id)).filter(event => event.title === 'Continuing in a new session').length, 1);
});

/** A project workspace with a granted shared base and skill, the plugin folder and a sibling project. */
async function guardFixture() {
  const root = path.join(tmp, `guard-${(counter += 1)}`);
  const registry = new WorkspaceRegistry({ root }); const library = await registry.library();
  const alpha = await registry.for('alpha'); const beta = await registry.for('beta');
  await fs.mkdir(path.join(library.knowledgeDir, 'shared'), { recursive: true }); await fs.writeFile(path.join(library.knowledgeDir, 'shared', 'index.md'), '# Shared');
  await fs.mkdir(path.join(library.knowledgeDir, 'not-granted'), { recursive: true }); await fs.writeFile(path.join(library.knowledgeDir, 'not-granted', 'index.md'), '# Not granted');
  await fs.mkdir(path.join(library.skillsDir, 'rca'), { recursive: true }); await fs.writeFile(path.join(library.skillsDir, 'rca', 'SKILL.md'), '# RCA');
  await alpha.applyLibraryGrants({ knowledge: ['shared'], skills: ['rca'] });
  await fs.writeFile(path.join(beta.dir, 'secret.txt'), 'beta only');
  await fs.writeFile(path.join(alpha.dir, 'notes.md'), 'notes');
  const pluginDir = path.join(root, 'plugin'); await fs.mkdir(path.join(pluginDir, 'agents'), { recursive: true }); await fs.writeFile(path.join(pluginDir, 'agents', 'a.md'), 'agent');
  const check = (toolName, input, task = null) => checkPathAccess({ toolName, input, workspace: alpha, task, pluginDir });
  return { root, alpha, beta, library, pluginDir, check };
}

test('FR-46: the file tools work inside the project workspace, with relative and absolute paths', async () => {
  const { alpha, check } = await guardFixture();
  for (const [tool, input] of [['Read', { file_path: 'notes.md' }], ['Read', { file_path: path.join(alpha.dir, 'notes.md') }], ['Write', { file_path: 'tasks/T-1/out.md', content: 'x' }], ['Edit', { file_path: path.join(alpha.dir, 'notes.md') }], ['NotebookEdit', { notebook_path: 'a.ipynb' }], ['Grep', { pattern: 'x' }], ['Grep', { pattern: 'x', path: 'knowledge' }], ['Glob', { pattern: '**/*.md' }], ['Glob', { pattern: 'knowledge/*.md', path: alpha.dir }]]) {
    assert.equal((await check(tool, input)).allowed, true, `${tool} ${JSON.stringify(input)}`);
  }
  assert.equal((await check('Bash', { command: 'ls /' })).allowed, true, 'Bash is not covered by the path guard');
});

test('FR-46: another project\'s files, parent folders and absolute paths elsewhere are refused for every file tool', async () => {
  const { beta, root, check } = await guardFixture();
  const outside = [path.join(beta.dir, 'secret.txt'), '../beta/secret.txt', '../beta/operations.yaml', '../../library/knowledge/not-granted/index.md', '/etc/passwd', path.join(root, 'library', 'knowledge', 'not-granted', 'index.md'), '..'];
  for (const target of outside) {
    for (const [tool, field] of [['Read', 'file_path'], ['Write', 'file_path'], ['Edit', 'file_path'], ['NotebookEdit', 'notebook_path'], ['Grep', 'path'], ['Glob', 'path']]) {
      const result = await check(tool, { [field]: target, pattern: '*' });
      assert.equal(result.allowed, false, `${tool} ${target}`);
      assert.match(result.reason, /outside this project's workspace/);
    }
  }
  // A Glob pattern can reach out on its own.
  assert.equal((await check('Glob', { pattern: '../beta/**/*.yaml' })).allowed, false);
  assert.equal((await check('Glob', { pattern: '/etc/*' })).allowed, false);
  assert.equal((await check('Glob', { pattern: '../../beta/*', path: 'knowledge' })).allowed, false);
});

test('FR-46: symlinks are resolved: a link out of the workspace, or one into an ungranted library entry, does not grant access', async () => {
  const { alpha, beta, library, root, check } = await guardFixture();
  await fs.symlink(beta.dir, path.join(alpha.dir, 'sneaky'));
  await fs.symlink(path.join(library.knowledgeDir, 'not-granted'), path.join(alpha.dir, 'knowledge', 'not-granted'));
  await fs.symlink(path.join(root, 'plugin'), path.join(alpha.dir, 'plug'));
  assert.equal((await check('Read', { file_path: 'sneaky/secret.txt' })).allowed, false);
  assert.equal((await check('Glob', { pattern: '*', path: 'sneaky' })).allowed, false);
  const grants = { knowledge: new Set(['shared']), skills: new Set(['rca']) };
  assert.equal((await checkPathAccess({ toolName: 'Read', input: { file_path: 'knowledge/not-granted/index.md' }, workspace: alpha, pluginDir: path.join(root, 'plugin'), grants })).allowed, false, 'a hand-made link to a library entry that is not granted');
  assert.equal((await checkPathAccess({ toolName: 'Read', input: { file_path: 'knowledge/shared/index.md' }, workspace: alpha, pluginDir: path.join(root, 'plugin'), grants })).allowed, true);
  assert.equal((await checkPathAccess({ toolName: 'Read', input: { file_path: 'knowledge/shared/index.md' }, workspace: alpha, pluginDir: path.join(root, 'plugin'), grants: { knowledge: new Set(), skills: new Set() } })).allowed, false, 'a grant that was removed closes the link');
  // A file that does not exist yet is judged by where it would land.
  assert.equal((await check('Write', { file_path: 'sneaky/new.md' })).allowed, false);
  assert.equal((await check('Write', { file_path: 'tasks/new/deep/er/file.md' })).allowed, true);
});

test('FR-46: granted library entries and the plugin folder are readable, not writable', async () => {
  const { alpha, pluginDir, root, check } = await guardFixture();
  assert.equal((await check('Read', { file_path: 'knowledge/shared/index.md' })).allowed, true, 'through the grant link');
  assert.equal((await check('Grep', { pattern: 'x', path: 'knowledge/shared' })).allowed, true);
  assert.equal((await check('Read', { file_path: path.join(root, 'library', 'knowledge', 'shared', 'index.md') })).allowed, true, 'by its library path');
  assert.equal((await check('Glob', { pattern: '*/SKILL.md', path: '.claude/skills' })).allowed, true);
  assert.equal((await check('Read', { file_path: path.join(pluginDir, 'agents', 'a.md') })).allowed, true);
  for (const [tool, input] of [['Write', { file_path: 'knowledge/shared/new.md' }], ['Edit', { file_path: 'knowledge/shared/index.md' }], ['Write', { file_path: path.join(root, 'library', 'knowledge', 'shared', 'x.md') }], ['Write', { file_path: path.join(pluginDir, 'agents', 'a.md') }], ['Edit', { file_path: '.claude/skills/rca/SKILL.md' }]]) {
    const result = await check(tool, input);
    assert.equal(result.allowed, false, `${tool} ${input.file_path}`);
    assert.match(result.reason, /read-only/);
  }
  assert.equal((await check('Read', { file_path: path.join(root, 'library', 'knowledge', 'not-granted', 'index.md') })).allowed, false, 'a library entry that is not granted');
  assert.equal((await check('Write', { file_path: 'knowledge/team-knowledge/lesson.md' })).allowed, true, 'the project\'s own base is writable');
  assert.ok(alpha.dir);
});

test('FR-46: the task that builds a shared base may write that base and its uploads, and nothing else in the library', async () => {
  const { library, root, check } = await guardFixture();
  await fs.mkdir(path.join(library.knowledgeDir, 'building'), { recursive: true });
  const task = { context: { knowledgeBase: 'building', sharedBase: true } };
  assert.equal((await check('Write', { file_path: path.join(root, 'library', 'knowledge', 'building', 'index.md') }, task)).allowed, true);
  assert.equal((await check('Read', { file_path: path.join(root, 'library', 'knowledge-uploads', 'building', 'a.pdf') }, task)).allowed, true);
  assert.equal((await check('Write', { file_path: path.join(root, 'library', 'knowledge', 'not-granted', 'index.md') }, task)).allowed, false);
  assert.equal((await check('Write', { file_path: path.join(root, 'library', 'knowledge', 'building', 'index.md') }, { context: { knowledgeBase: 'building' } })).allowed, false, 'only when the task is marked as building a shared base');
  assert.equal((await check('Write', { file_path: path.join(root, 'library', 'knowledge', 'building', 'index.md') })).allowed, false);
});

test('FR-46: the gate denies an outside path as a recorded denial and lets a project path through', async () => {
  const sdk = recordingSdk({ probe: [['Read', { file_path: 'CLAUDE.md' }], ['Read', { file_path: '../beta/operations.yaml' }], ['Write', { file_path: '/etc/hosts', content: 'x' }], ['Grep', { pattern: 'a', path: '..' }]] });
  const { store, runtime, registry } = await harness({ sdk });
  await registry.for('beta');
  const task = await runtime.startTask({ scope: systemScope('alpha'), prompt: 'Look around', user, notify: false });
  await finished(store, task.id);
  assert.deepEqual(sdk.decisions.map(item => item.behavior), ['allow', 'deny', 'deny', 'deny']);
  assert.match(sdk.decisions[1].message, /outside this project's workspace/);
  const denied = (await store.listEvents(task.id)).filter(event => event.type === 'approval.denied');
  assert.equal(denied.length, 3);
  assert.match(denied[0].title, /^Blocked: /);
  assert.equal((await store.getTask(task.id)).status, 'done', 'a refusal does not fail the task');
});

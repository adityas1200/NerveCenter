import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createWorkspace } from '../src/workspace/workspace.mjs';
import { createSecretStore } from '../src/secrets/secret-store.mjs';
import { KnowledgeService, folderTree, normalizeFolders } from '../src/knowledge/knowledge-service.mjs';
import { hasGit, tempDir } from './helpers.mjs';

// Look inside a repository before adding it, and add only some of its folders (sparse checkout).

const run = promisify(execFile);
const tmp = await tempDir('nc-knowledge-folders-', { maxRetries: 3 });

async function throwawayRepo(name) {
  const source = path.join(tmp, name);
  const git = args => run('git', ['-C', source, ...args]);
  await run('git', ['init', '-q', '-b', 'main', source]);
  await git(['config', 'user.email', 'test@example.com']); await git(['config', 'user.name', 'Test']); await git(['config', 'core.autocrlf', 'false']);
  const write = async (file, text) => { const target = path.join(source, ...file.split('/')); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, text, 'utf8'); };
  await write('index.md', '---\ntype: Index\ntitle: Ops knowledge\ndescription: Everything.\n---\n# Ops knowledge\n');
  await write('README.md', '# Readme\n');
  await write('runbooks/index.md', '# Runbooks\n');
  await write('runbooks/job-repair.md', '# Job repair\n');
  await write('runbooks/deep/a/b/c/leaf.md', '# Deep leaf\n');
  await write('platform/index.md', '# Platform\n');
  await write('platform/diagram.png', 'png');
  await write('incidents/2026-07.md', '# July\n');
  await write('.github/workflows/ci.yml', 'on: push\n');
  await git(['add', '.']); await git(['commit', '-q', '-m', 'first']);
  return { source, git, write };
}

test('chosen folders are cleaned: whole repository, nested and unsafe paths', () => {
  assert.deepEqual(normalizeFolders(undefined), []);
  assert.deepEqual(normalizeFolders(['runbooks', '']), []);
  assert.deepEqual(normalizeFolders(['./runbooks/', 'platform\\', 'runbooks/deep', 'platform']), ['platform', 'runbooks']);
  assert.throws(() => normalizeFolders(['../outside']), error => error.statusCode === 400 && /not a folder inside/.test(error.message));
  assert.throws(() => normalizeFolders(['.git/hooks']), /not a folder inside/);
  assert.throws(() => normalizeFolders('runbooks'), /list of folder paths/);
});

test('the folder tree counts markdown files at every level and stops at depth 4', () => {
  const tree = folderTree(['index.md', 'a/one.md', 'a/b/two.md', 'a/b/c/d/e/deep.md', 'x/pic.png']);
  assert.equal(tree.files, 5); assert.equal(tree.markdown, 4); assert.deepEqual(tree.rootFiles, ['index.md']);
  const a = tree.folders.find(item => item.name === 'a');
  assert.deepEqual({ files: a.files, markdown: a.markdown }, { files: 3, markdown: 3 });
  const d = a.children[0].children[0].children[0];
  assert.equal(d.path, 'a/b/c/d'); assert.deepEqual(d.children, []); assert.equal(d.markdown, 1);
  assert.equal(tree.folders.find(item => item.name === 'x').markdown, 0);
});

test('inspect reads the folder tree from a throwaway clone and leaves nothing behind', { skip: !hasGit && 'git is not installed' }, async () => {
  const { source } = await throwawayRepo('inspect-repo');
  const tempDir = path.join(tmp, 'inspect-temp'); await fs.mkdir(tempDir, { recursive: true });
  const workspace = await createWorkspace({ dir: path.join(tmp, 'ws-inspect') });
  const knowledge = new KnowledgeService({ workspace, secretStore: createSecretStore(), tempDir });
  const result = await knowledge.inspect({ url: source });
  assert.equal(result.branch, 'main'); assert.ok(result.commit); assert.equal(result.suggestedTitle, 'Inspect repo');
  assert.deepEqual(result.rootFiles, ['README.md', 'index.md']);
  assert.deepEqual(result.folders.map(item => item.name), ['incidents', 'platform', 'runbooks']); // hidden folders are left out
  const runbooks = result.folders.find(item => item.name === 'runbooks');
  assert.equal(runbooks.markdown, 3); assert.equal(runbooks.files, 3);
  assert.equal(result.folders.find(item => item.name === 'platform').markdown, 1);
  assert.equal(result.markdown, 7);
  assert.deepEqual(await fs.readdir(tempDir), [], 'the temporary clone is deleted');
  assert.deepEqual(await fs.readdir(workspace.knowledgeDir).then(items => items.filter(item => !item.startsWith('.') && item !== 'index.md')), [], 'nothing is added to the workspace');
  await assert.rejects(knowledge.inspect({ url: path.join(tmp, 'missing-repo') }), /Could not read the repository/);
  await assert.rejects(knowledge.inspect({ url: source, branch: 'no-such-branch' }), /Could not read the repository/);
  assert.deepEqual(await fs.readdir(tempDir), []);
});

test('tokens never appear in inspect errors', { skip: !hasGit && 'git is not installed' }, async () => {
  const workspace = await createWorkspace({ dir: path.join(tmp, 'ws-token') });
  const runner = async (_git, args) => { const error = new Error(`Command failed: git ${args.join(' ')}`); error.stderr = ''; throw error; };
  const knowledge = new KnowledgeService({ workspace, secretStore: createSecretStore(), runner, tempDir: tmp });
  const failure = await knowledge.inspect({ url: 'https://github.com/acme/private.git', token: 'super-secret-token', username: 'me' }).catch(error => error);
  assert.match(failure.message, /Could not read the repository/);
  assert.equal(failure.message.includes(Buffer.from('me:super-secret-token').toString('base64')), false);
  assert.equal(failure.message.includes('super-secret-token'), false);
});

test('adding with folders checks out only those folders plus root files, and sync keeps it that way', { skip: !hasGit && 'git is not installed' }, async () => {
  const { source, git, write } = await throwawayRepo('sparse-repo');
  const workspace = await createWorkspace({ dir: path.join(tmp, 'ws-sparse') });
  const knowledge = new KnowledgeService({ workspace, secretStore: createSecretStore() });
  await assert.rejects(knowledge.add({ title: 'Nope', url: source, folders: ['no-such-folder'] }), error => error.statusCode === 400 && /Not in the repository: no-such-folder/.test(error.message));
  assert.equal(await fs.access(workspace.knowledgePath('nope')).then(() => true, () => false), false, 'a failed add leaves no folder');

  const added = await knowledge.add({ title: 'Ops knowledge', url: source, folders: ['runbooks', 'incidents/'], user: { id: 'mitesh' } });
  assert.deepEqual(added.folders, ['incidents', 'runbooks']);
  const dir = workspace.knowledgePath('ops-knowledge');
  const onDisk = async relative => fs.access(path.join(dir, ...relative.split('/'))).then(() => true, () => false);
  assert.equal(await onDisk('index.md'), true); assert.equal(await onDisk('README.md'), true);
  assert.equal(await onDisk('runbooks/job-repair.md'), true); assert.equal(await onDisk('runbooks/deep/a/b/c/leaf.md'), true);
  assert.equal(await onDisk('incidents/2026-07.md'), true);
  assert.equal(await onDisk('platform'), false);
  assert.equal(added.files, 6); assert.equal(added.pendingChanges, 0);
  assert.deepEqual((await knowledge.list()).items[0].folders, ['incidents', 'runbooks']);

  await write('runbooks/backfill.md', '# Backfill\n'); await write('platform/new.md', '# New\n');
  await git(['add', '.']); await git(['commit', '-q', '-m', 'second']);
  const synced = await knowledge.sync('ops-knowledge');
  assert.equal(synced.lastError, null); assert.deepEqual(synced.folders, ['incidents', 'runbooks']);
  assert.equal(await onDisk('runbooks/backfill.md'), true);
  assert.equal(await onDisk('platform'), false);
  assert.equal(synced.files, 7);

  // Without folders the whole repository is cloned and no folders are stored.
  const whole = await knowledge.add({ title: 'Everything', url: source, folders: [] });
  assert.deepEqual(whole.folders, []);
  assert.equal(await fs.access(path.join(workspace.knowledgePath('everything'), 'platform', 'new.md')).then(() => true, () => false), true);
});

test('file() resolves a bare filename by searching the base when the exact path is wrong', { skip: !hasGit && 'git is not installed' }, async () => {
  const { source, write, git } = await throwawayRepo('link-repo');
  await write('rca-and-failures/pipeline-failure-symptom-checklist.md', '# Checklist\n');
  await write('runbooks/duplicate.md', '# Runbooks copy\n');
  await write('platform/duplicate.md', '# Platform copy\n');
  await git(['add', '.']); await git(['commit', '-q', '-m', 'add citation targets']);
  const workspace = await createWorkspace({ dir: path.join(tmp, 'ws-links') });
  const knowledge = new KnowledgeService({ workspace, secretStore: createSecretStore() });
  await knowledge.add({ title: 'Ops knowledge', url: source });

  // The exact folder-qualified path always works.
  const exact = await knowledge.file('ops-knowledge', 'rca-and-failures/pipeline-failure-symptom-checklist.md');
  assert.match(exact.content, /# Checklist/);

  // A citation that dropped the subfolder (the bug: agent/frontend links sometimes cite just the filename)
  // still resolves, because it uniquely matches one file in the base.
  const bare = await knowledge.file('ops-knowledge', 'pipeline-failure-symptom-checklist.md');
  assert.equal(bare.path, 'rca-and-failures/pipeline-failure-symptom-checklist.md');
  assert.match(bare.content, /# Checklist/);

  // A bare filename that exists in more than one folder is ambiguous: no silent guess, same error as before.
  await assert.rejects(knowledge.file('ops-knowledge', 'duplicate.md'), error => error.statusCode === 404 && /not found/i.test(error.message));

  // A bare filename that genuinely doesn't exist anywhere still 404s.
  await assert.rejects(knowledge.file('ops-knowledge', 'nope.md'), error => error.statusCode === 404 && /not found/i.test(error.message));
});

test('reconcileGitBases re-clones a Git base whose .git was lost to an S3 workspace restore', { skip: !hasGit && 'git is not installed' }, async () => {
  const { source } = await throwawayRepo('reconcile-repo');
  const workspace = await createWorkspace({ dir: path.join(tmp, 'ws-reconcile') });
  const knowledge = new KnowledgeService({ workspace, secretStore: createSecretStore() });
  const added = await knowledge.add({ title: 'Ops knowledge', url: source });
  const dir = workspace.knowledgePath('ops-knowledge');

  // Simulate a workspace-sync restore: the mirror kept every tracked file but never uploaded .git.
  await fs.rm(path.join(dir, '.git'), { recursive: true, force: true });
  assert.equal(await fs.access(path.join(dir, 'index.md')).then(() => true, () => false), true, 'restored content is still there');

  const before = await knowledge.list();
  assert.equal(before.items[0].lastError, null, 'a bare content restore does not itself report an error');
  await assert.rejects(knowledge.sync('ops-knowledge'), /Sync failed/, 'sync fails without .git, exactly like the real bug');

  const { reconciled } = await knowledge.reconcileGitBases();
  assert.equal(reconciled, 1);
  assert.equal(await fs.access(path.join(dir, '.git')).then(() => true, () => false), true, '.git is back');
  assert.equal(await fs.access(path.join(dir, 'index.md')).then(() => true, () => false), true, 'content survives the re-clone');

  const synced = await knowledge.sync('ops-knowledge');
  assert.equal(synced.lastError, null, 'sync now works again');
  assert.equal(synced.lastCommit, added.lastCommit);

  // A base that already has .git (the normal case) is left untouched.
  const again = await knowledge.reconcileGitBases();
  assert.equal(again.reconciled, 0);
});

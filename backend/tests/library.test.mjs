import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import AdmZip from 'adm-zip';
import { createWorkspace } from '../src/workspace/workspace.mjs';
import { createSecretStore } from '../src/secrets/secret-store.mjs';
import { SkillService } from '../src/skills/skill-service.mjs';
import { KnowledgeService, normalizeGitUrl } from '../src/knowledge/knowledge-service.mjs';
import { hasGit, tempDir } from './helpers.mjs';

const run = promisify(execFile);
const tmp = await tempDir('nc-library-');

test('a zipped skill folder becomes a custom skill; unsafe zips are rejected', async () => {
  const workspace = await createWorkspace({ dir: path.join(tmp, 'ws-skills') });
  const skills = new SkillService({ workspace });
  assert.equal((await skills.list()).length, 23);
  const zip = new AdmZip();
  zip.addFile('failure-summary/SKILL.md', Buffer.from('---\nname: failure-summary\ndescription: Summarise a failure in one paragraph.\n---\n# Failure summary\n'));
  zip.addFile('failure-summary/references/style.md', Buffer.from('# Style\n'));
  zip.addFile('__MACOSX/._SKILL.md', Buffer.from('junk'));
  const uploaded = await skills.upload({ zipBase64: zip.toBuffer().toString('base64'), user: { id: 'mitesh' } });
  assert.equal(uploaded.id, 'custom:failure-summary'); assert.equal(uploaded.files, 2); assert.equal(uploaded.replaced, false); assert.equal(uploaded.origin, 'custom');
  const list = await skills.list();
  assert.equal(list.length, 24); assert.ok(list.every(skill => !('dir' in skill)));
  const tree = await skills.tree('custom:failure-summary');
  assert.deepEqual(tree.map(item => item.name), ['references', 'SKILL.md']);
  assert.match((await skills.file('custom:failure-summary', 'SKILL.md')).content, /^---\nname: failure-summary/);
  const again = await skills.upload({ zipBase64: zip.toBuffer().toString('base64') });
  assert.equal(again.replaced, true);
  const bad = new AdmZip(); bad.addFile('../escape/SKILL.md', Buffer.from('---\nname: x\n---\n'));
  await skills.upload({ zipBase64: bad.toBuffer().toString('base64') }).catch(() => null); // adm-zip may normalise the entry; either way nothing lands outside .claude/skills
  assert.equal(await fs.access(path.join(tmp, 'ws-skills', '.claude', 'escape')).then(() => true, () => false), false);
  assert.equal(await fs.access(path.join(tmp, 'escape')).then(() => true, () => false), false);
  for (const leftover of await fs.readdir(workspace.skillsDir)) if (leftover !== 'failure-summary') await fs.rm(path.join(workspace.skillsDir, leftover), { recursive: true, force: true });
  const empty = new AdmZip(); empty.addFile('readme.md', Buffer.from('no skill'));
  await assert.rejects(skills.upload({ zipBase64: empty.toBuffer().toString('base64') }), /no SKILL.md/);
  await assert.rejects(skills.remove('plugin:rca'), /Only custom skills/);
  assert.equal(await skills.remove('custom:failure-summary'), true);
  assert.equal((await skills.list()).length, 23);
});

test('git URLs are normalised and tokens are kept out of them', () => {
  assert.equal(normalizeGitUrl('https://github.com/acme/runbooks.git/'), 'https://github.com/acme/runbooks.git');
  assert.equal(normalizeGitUrl('git@github.com:acme/runbooks.git'), 'git@github.com:acme/runbooks.git');
  assert.throws(() => normalizeGitUrl('https://user:token@github.com/acme/runbooks.git'), /token field/);
  assert.throws(() => normalizeGitUrl('ftp://x'), /https/);
});

test('a git repository is cloned into knowledge/, synced, indexed and removed', { skip: !hasGit && 'git is not installed' }, async () => {
  const source = path.join(tmp, 'source-repo'); await fs.mkdir(source, { recursive: true });
  const git = args => run('git', ['-C', source, ...args]);
  await run('git', ['init', '-q', '-b', 'main', source]);
  await git(['config', 'user.email', 'test@example.com']); await git(['config', 'user.name', 'Test']);
  await fs.writeFile(path.join(source, 'index.md'), '---\ntype: Index\ntitle: Platform runbooks\ndescription: Recovery steps.\n---\n# Runbooks\n', 'utf8');
  await fs.mkdir(path.join(source, 'pipelines'), { recursive: true }); await fs.writeFile(path.join(source, 'pipelines', 'restart.md'), '# Restart a job\n', 'utf8');
  await git(['add', '.']); await git(['commit', '-q', '-m', 'first']);

  const workspace = await createWorkspace({ dir: path.join(tmp, 'ws-knowledge') });
  const knowledge = new KnowledgeService({ workspace, secretStore: createSecretStore() });
  const added = await knowledge.add({ title: 'Platform runbooks', url: source, user: { id: 'mitesh' } });
  assert.equal(added.name, 'platform-runbooks'); assert.equal(added.kind, 'git'); assert.equal(added.files, 2); assert.equal(added.hasIndex, true); assert.equal(added.title, 'Platform runbooks'); assert.ok(added.lastCommit);
  const index = await fs.readFile(path.join(workspace.knowledgeDir, 'index.md'), 'utf8');
  assert.match(index, /\[Platform runbooks\]\(platform-runbooks\/index.md\): Recovery steps/);
  await assert.rejects(knowledge.add({ title: 'Platform runbooks', url: source }), /already exists/);

  await fs.writeFile(path.join(source, 'pipelines', 'backfill.md'), '# Backfill\n', 'utf8'); await git(['add', '.']); await git(['commit', '-q', '-m', 'second']);
  const synced = await knowledge.sync('platform-runbooks');
  assert.equal(synced.files, 3); assert.notEqual(synced.lastCommit, added.lastCommit); assert.equal(synced.lastError, null);
  const tree = await knowledge.tree('platform-runbooks');
  assert.deepEqual(tree.map(item => item.name), ['pipelines', 'index.md']);
  assert.equal(tree[0].children.length, 2); assert.ok(tree[1].size > 0);
  assert.match((await knowledge.file('platform-runbooks', 'pipelines/backfill.md')).content, /Backfill/);
  await assert.rejects(knowledge.file('platform-runbooks', '../operations.yaml'), /escapes/);

  const listed = await knowledge.list();
  assert.equal(listed.items.length, 1); assert.equal(listed.mcp.mode, 'local'); assert.equal(listed.items[0].pendingChanges, 0);
  // An agent draft in the clone is a pending change: it shows in the list and blocks a sync until a person deals with it.
  const clone = workspace.knowledgePath('platform-runbooks');
  await fs.writeFile(path.join(clone, 'pipelines', 'proposed-rollback.md'), '---\ntype: Playbook\nstatus: draft\n---\n# Rollback\n', 'utf8');
  assert.deepEqual(await knowledge.pendingChanges('platform-runbooks'), ['pipelines/proposed-rollback.md']);
  assert.equal((await knowledge.list()).items[0].pendingChanges, 1);
  await assert.rejects(knowledge.sync('platform-runbooks'), /1 uncommitted change .*proposed-rollback\.md/);
  await fs.rm(path.join(clone, 'pipelines', 'proposed-rollback.md'));
  assert.equal((await knowledge.sync('platform-runbooks')).lastError, null);
  assert.equal(await knowledge.remove('platform-runbooks'), true);
  assert.equal((await knowledge.list()).items.length, 0);
  assert.equal((await fs.readFile(path.join(workspace.knowledgeDir, 'index.md'), 'utf8')).includes('platform-runbooks'), false);
});

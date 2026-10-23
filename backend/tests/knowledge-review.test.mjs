import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createWorkspace } from '../src/workspace/workspace.mjs';
import { createSecretStore } from '../src/secrets/secret-store.mjs';
import { KnowledgeService, compareUrl, normalizeGitUrl, openPullRequest, repositoryOf } from '../src/knowledge/knowledge-service.mjs';
import { hasGit, tempDir } from './helpers.mjs';

// A Git knowledge base belongs to the client's reviewers: what Sonic learns and a person keeps in
// NerveCenter becomes a pull request on the base's repository, and counts once it is merged.

const run = promisify(execFile);
const tmp = await tempDir('nc-knowledge-review-', { maxRetries: 3 });

test('repository URL caller errors carry HTTP 400 status', () => {
  assert.throws(() => normalizeGitUrl(''), error => error.statusCode === 400 && /URL is required/.test(error.message));
  assert.throws(() => normalizeGitUrl('https://user:token@example.com/repo.git'), error => error.statusCode === 400 && /token field/.test(error.message));
});
const reviewer = { id: 'mitesh.shinde', name: 'Mitesh Shinde' };

test('repository, compare link and pull request for GitHub and Bitbucket', async () => {
  assert.deepEqual(repositoryOf('https://github.com/acme/ops-knowledge.git'), { host: 'github.com', owner: 'acme', repo: 'ops-knowledge' });
  assert.deepEqual(repositoryOf('git@bitbucket.org:zs/knowledge.git'), { host: 'bitbucket.org', owner: 'zs', repo: 'knowledge' });
  assert.equal(repositoryOf('https://gitlab.example.com/a/b'), null);
  assert.equal(compareUrl('https://github.com/acme/kb', 'main', 'sonic/x'), 'https://github.com/acme/kb/compare/main...sonic%2Fx?expand=1');
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 201, json: async () => (url.includes('github') ? { html_url: 'https://github.com/acme/kb/pull/7', number: 7 } : { id: 3, links: { html: { href: 'https://bitbucket.org/zs/kb/pull-requests/3' } } }) }; };
  assert.deepEqual(await openPullRequest({ url: 'https://github.com/acme/kb', base: 'main', branch: 'sonic/x', title: 'T', body: 'B', credentials: { token: 'ghp_x' }, fetchImpl }), { url: 'https://github.com/acme/kb/pull/7', number: 7 });
  assert.equal(JSON.parse(calls[0].init.body).head, 'sonic/x'); assert.equal(calls[0].init.headers.Authorization, 'Bearer ghp_x');
  assert.deepEqual(await openPullRequest({ url: 'https://bitbucket.org/zs/kb', base: 'main', branch: 'sonic/x', title: 'T', body: 'B', credentials: { username: 'mitesh', token: 'app-pass' }, fetchImpl }), { url: 'https://bitbucket.org/zs/kb/pull-requests/3', number: 3 });
  assert.match(calls[1].init.headers.Authorization, /^Basic /);
  assert.deepEqual(JSON.parse(calls[1].init.body).destination, { branch: { name: 'main' } });
  assert.match((await openPullRequest({ url: 'https://github.com/acme/kb', base: 'main', branch: 'b', title: 'T', body: 'B', credentials: null, fetchImpl })).error, /no token/);
});

test('keeping a draft in a Git base proposes it on a branch and leaves the base as merged', { skip: !hasGit && 'git is not installed' }, async () => {
  // The client's repository (a bare remote) with one page.
  const seed = path.join(tmp, 'seed'); const remote = path.join(tmp, 'remote.git');
  await run('git', ['init', '-q', '-b', 'main', seed]);
  for (const args of [['config', 'user.email', 't@example.com'], ['config', 'user.name', 'T'], ['config', 'core.autocrlf', 'false']]) await run('git', ['-C', seed, ...args]);
  await fs.mkdir(path.join(seed, 'known-issues'), { recursive: true });
  await fs.writeFile(path.join(seed, 'index.md'), '---\ntype: Index\ntitle: Ops\ndescription: Ops knowledge.\n---\n# Ops\n', 'utf8');
  await fs.writeFile(path.join(seed, 'known-issues', 'pipelines.md'), '---\ntype: Playbook\ntitle: Pipelines\ndescription: Known pipeline failures.\nstatus: stable\n---\n# Pipelines\n', 'utf8');
  await run('git', ['-C', seed, 'add', '.']); await run('git', ['-C', seed, 'commit', '-q', '-m', 'first']);
  await run('git', ['clone', '-q', '--bare', seed, remote]);

  const workspace = await createWorkspace({ dir: path.join(tmp, 'ws') });
  const knowledge = new KnowledgeService({ workspace, secretStore: createSecretStore({ kind: 'memory' }), fetchImpl: async () => { throw new Error('no network in tests'); } });
  await knowledge.add({ name: 'ops', title: 'Ops', url: remote, user: reviewer });
  assert.equal((await knowledge.list()).items.find(item => item.name === 'ops').review, 'pull_request');
  await assert.rejects(knowledge.setReview('ops', 'unsupported'), error => error.statusCode === 400 && /review must be/.test(error.message));

  await knowledge.drafts.write({ decision: 'create', base: 'ops', path: 'known-issues/expired-token.md', title: 'Expired service principal token', description: 'Jobs that fail when the service principal secret expires.', content: '## Fix\n\nRotate the secret.', placementReason: 'A new failure pattern.', checked: ['ops/known-issues/pipelines.md'], sourceTicket: 'OPS-12' }, { taskId: 'T-1', actor: reviewer });
  const kept = await knowledge.keepDrafts('ops', 'known-issues/expired-token.md', reviewer);
  assert.equal(kept.review, 'pull_request'); assert.equal(kept.pushed, true);
  assert.match(kept.branch, /^sonic\/knowledge-\d{4}-\d{2}-\d{2}-expired-token-/);
  // The page is on the review branch of the remote, not on main, and not yet in the local base.
  const branchFile = await run('git', ['-C', remote, 'show', `${kept.branch}:known-issues/expired-token.md`]);
  assert.match(branchFile.stdout, /status: stable/);
  await assert.rejects(run('git', ['-C', remote, 'show', 'main:known-issues/expired-token.md']));
  await assert.rejects(fs.access(path.join(workspace.knowledgeDir, 'ops', 'known-issues', 'expired-token.md')));
  const base = (await knowledge.list()).items.find(item => item.name === 'ops');
  assert.equal(base.proposals[0].branch, kept.branch); assert.match(base.lastError, /open the pull request by hand/);
  // The base syncs cleanly afterwards: nothing kept is left waiting locally.
  await knowledge.sync('ops');

  // Set to take changes directly, the next keep goes straight to main as before.
  await knowledge.setReview('ops', 'direct');
  await knowledge.drafts.write({ decision: 'create', base: 'ops', path: 'known-issues/late-files.md', title: 'Late vendor files', description: 'Loads that fail because the vendor file lands late.', content: '## Fix\n\nWait and rerun.', placementReason: 'New.', checked: [], sourceTicket: 'OPS-13' }, { taskId: 'T-2', actor: reviewer });
  const direct = await knowledge.keepDrafts('ops', 'known-issues/late-files.md', reviewer);
  assert.equal(direct.pushed, true); assert.equal(direct.review, undefined);
  assert.match((await run('git', ['-C', remote, 'show', 'main:known-issues/late-files.md'])).stdout, /Late vendor files/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { githubGitEnv, githubSource, pullRequestLines } from '../src/tasks/source-control.mjs';

test('git and gh sign in with the GitHub token through env only, scoped to github.com', () => {
  assert.deepEqual(githubGitEnv({}), {});
  const env = githubGitEnv({ GITHUB_TOKEN: 'ghp_abc' });
  assert.equal(env.GH_TOKEN, 'ghp_abc');
  assert.equal(env.GIT_TERMINAL_PROMPT, '0');
  assert.equal(env.GIT_CONFIG_KEY_0, 'http.https://github.com/.extraHeader');
  assert.equal(env.GIT_CONFIG_VALUE_0, `Authorization: Basic ${Buffer.from('x-access-token:ghp_abc').toString('base64')}`);
  assert.equal(githubGitEnv({ GH_TOKEN: 'one', GITHUB_TOKEN: 'two' }).GH_TOKEN, 'one', 'an explicit GH_TOKEN wins');
});

test('the GitHub source control names the repository, base branch and mirror', () => {
  const dir = path.resolve('workspace');
  assert.equal(githubSource({}, dir), null);
  assert.equal(githubSource({ source_control: { platform: 'bitbucket', repository: 'a/b' } }, dir), null);
  assert.equal(githubSource({ source_control: { platform: 'github', repository: 'not a repo' } }, dir), null);
  assert.deepEqual(githubSource({ source_control: { platform: 'github', repository: 'https://github.com/Acme/Data-Platform.git', default_branch: 'develop' } }, dir), { slug: 'Acme/Data-Platform', remote: 'https://github.com/Acme/Data-Platform.git', base: 'develop', mirror: 'source/acme-data-platform' });
});

test('the agent is told how to raise a pull request only when there is a repository, and to ask for a token when it cannot push', () => {
  assert.deepEqual(pullRequestLines({ source: null, relativeTaskDir: 'tasks/T-1', authenticated: true, agentName: 'Sonic', appTools: true }), []);
  const source = { slug: 'acme/dp', remote: 'https://github.com/acme/dp.git', base: 'main', mirror: 'source/acme-dp' };
  const ready = pullRequestLines({ source, relativeTaskDir: 'tasks/T-1', authenticated: true, agentName: 'Sonic', appTools: true }).join('\n');
  assert.match(ready, /git clone .* https:\/\/github\.com\/acme\/dp\.git tasks\/T-1\/repo/);
  assert.match(ready, /gh pr create --repo acme\/dp --base main/);
  assert.match(ready, /never merge/);
  assert.match(ready, /show_pull_request/);
  const noToken = pullRequestLines({ source, relativeTaskDir: 'tasks/T-1', authenticated: false, agentName: 'Sonic', appTools: true }).join('\n');
  assert.match(noToken, /No GitHub token/);
  assert.doesNotMatch(noToken, /gh pr create/);
});

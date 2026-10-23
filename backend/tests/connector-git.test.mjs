import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ConnectorService } from '../src/connectors/connector-service.mjs';
import { createWorkspace } from '../src/workspace/workspace.mjs';
import { createSecretStore } from '../src/secrets/secret-store.mjs';
import { tempDir } from './helpers.mjs';

// A git repository from the Add connection dialog: repository link, branch, access token, and
// whether it is knowledge (a separate branch Sonic reads) or the code-fix repository.

const tmp = await tempDir('nc-connector-git-');
const newWorkspace = () => createWorkspace({ dir: path.join(tmp, `ws-${Math.random().toString(36).slice(2)}`) });

test('a git connection keeps repository and branch in yaml, the token in the secret store, and becomes the code repository', async () => {
  const workspace = await newWorkspace();
  const secretStore = createSecretStore();
  const service = new ConnectorService({ workspace, secretStore });
  const card = await service.saveCustom({ kind: 'git', title: 'Data platform repo', description: 'Pipeline code', repository: 'https://bitbucket.org/acme/data-platform/', branch: 'develop', token: 'bb-secret' });
  assert.equal(card.id, 'data-platform-repo'); assert.equal(card.connectionKind, 'cli'); assert.equal(card.endpoint, 'https://bitbucket.org/acme/data-platform (develop)');
  assert.deepEqual(card.settings, { command: 'git', repository: 'https://bitbucket.org/acme/data-platform', branch: 'develop' });
  const operations = await workspace.readOperations();
  assert.deepEqual(operations.connections['data-platform-repo'], { kind: 'cli', command: 'git', repository: 'https://bitbucket.org/acme/data-platform', branch: 'develop', env: { DATA_PLATFORM_REPO_TOKEN: '${DATA_PLATFORM_REPO_TOKEN}' } });
  assert.equal(await secretStore.get('connectors/data-platform-repo/DATA_PLATFORM_REPO_TOKEN'), 'bb-secret');
  assert.equal((await fs.readFile(workspace.operationsPath, 'utf8')).includes('bb-secret'), false);
  assert.equal(operations.source_control.platform, 'bitbucket'); assert.equal(operations.source_control.connection, 'data-platform-repo');
  assert.equal(operations.source_control.repository, 'https://bitbucket.org/acme/data-platform'); assert.equal(operations.source_control.default_branch, 'develop');
  assert.deepEqual(card.usedFor.map(use => use.label), ['Code fixes']);

  // A second, knowledge-only repository never takes over source_control.
  await service.saveCustom({ kind: 'git', title: 'Runbooks', repository: 'https://bitbucket.org/acme/data-platform', branch: 'knowledge', knowledge: true });
  assert.equal((await workspace.readOperations()).source_control.connection, 'data-platform-repo');
  assert.deepEqual((await workspace.validate()).errors.filter(error => /connection|secret/i.test(error)), []);

  // Removing the code repository clears source_control.connection instead of leaving a dangling name.
  await service.remove('data-platform-repo');
  assert.equal((await workspace.readOperations()).source_control.connection, '');
  assert.deepEqual((await workspace.validate()).errors.filter(error => /connection/i.test(error)), []);
});

test('a git connection needs an HTTPS repository link and a plain branch name', async () => {
  const service = new ConnectorService({ workspace: await newWorkspace(), secretStore: createSecretStore() });
  await assert.rejects(service.saveCustom({ kind: 'git', title: 'Bad', repository: 'git@bitbucket.org:acme/x.git' }), /HTTPS URL/);
  await assert.rejects(service.saveCustom({ kind: 'git', title: 'Bad', repository: 'https://user:pw@bitbucket.org/acme/x' }), /not in the repository link/);
  await assert.rejects(service.saveCustom({ kind: 'git', title: 'Bad', repository: 'https://bitbucket.org/acme/x', branch: 'main; rm -rf' }), /Branch/);
});

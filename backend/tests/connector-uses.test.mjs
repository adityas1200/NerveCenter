import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ConnectorService, connectionUses } from '../src/connectors/connector-service.mjs';
import { createWorkspace } from '../src/workspace/workspace.mjs';
import { createSecretStore } from '../src/secrets/secret-store.mjs';
import { tempDir } from './helpers.mjs';

// "Used for" on connector cards, and adding REST API and command-line connections from the page.

const tmp = await tempDir('nc-connector-uses-');
const newWorkspace = () => createWorkspace({ dir: path.join(tmp, `ws-${Math.random().toString(36).slice(2)}`) });

test('a connection is used by every operations.yaml section that names it, at any depth', () => {
  const operations = {
    ticketing: { platform: 'servicenow', connection: 'servicenow', app: { sources: [{ platform: 'jira', connection: 'atlassian' }] } },
    platforms: [{ name: 'commercial', connection: 'databricks' }],
    identity: { connection: 'identity' },
    documents: { connection: 'docs' },
    communication: { connection: 'mail' },
    source_control: { connection: 'git' },
    knowledge: { connection: 'confluence' },
  };
  assert.deepEqual(connectionUses(operations, 'servicenow'), [{ section: 'ticketing', label: 'Tickets' }]);
  assert.deepEqual(connectionUses(operations, 'atlassian'), [{ section: 'ticketing', label: 'Tickets' }]);
  assert.deepEqual(connectionUses(operations, 'databricks'), [{ section: 'platforms', label: 'Pipelines and data quality' }]);
  assert.deepEqual(connectionUses(operations, 'identity').map(use => use.label), ['Access requests']);
  assert.deepEqual(connectionUses(operations, 'docs').map(use => use.label), ['Documents and reports']);
  assert.deepEqual(connectionUses(operations, 'mail').map(use => use.label), ['Mail']);
  assert.deepEqual(connectionUses(operations, 'git').map(use => use.label), ['Code fixes']);
  assert.deepEqual(connectionUses(operations, 'confluence').map(use => use.label), ['Knowledge']);
  assert.deepEqual(connectionUses(operations, 'nothing'), []);
  assert.deepEqual(connectionUses({}, 'git'), []);
});

test('cards carry kind, endpoint, "used for" and the knowledge-source flag', async () => {
  const workspace = await newWorkspace();
  const service = new ConnectorService({ workspace, secretStore: createSecretStore() });
  await workspace.setConnection('identity', { kind: 'api', base_url: 'http://127.0.0.1:8714/identity', auth: 'none' });
  await workspace.setConnection('git', { kind: 'cli', command: 'git' });
  await workspace.setConnection('confluence', { kind: 'mcp', transport: 'http', url: 'https://mcp.example.com/confluence' });
  await workspace.setSection('identity', { platform: 'helixa-idm', connection: 'identity' });
  await workspace.setSection('source_control', { platform: 'git', connection: 'git' });
  await workspace.setSection('knowledge', { mode: 'both', path: 'knowledge', connection: 'confluence' });
  const cards = await service.list();
  const identity = cards.find(card => card.id === 'identity');
  assert.equal(identity.connectionKind, 'api'); assert.equal(identity.endpoint, 'http://127.0.0.1:8714/identity'); assert.equal(identity.origin, 'operations');
  assert.deepEqual(identity.usedFor, [{ section: 'identity', label: 'Access requests' }]);
  assert.match(identity.description, /not an MCP server/); assert.match(identity.description, /grant, remove and review access/);
  const git = cards.find(card => card.id === 'git');
  assert.equal(git.endpoint, 'git'); assert.match(git.description, /Command-line tool/); assert.deepEqual(git.usedFor.map(use => use.label), ['Code fixes']);
  const confluence = cards.find(card => card.id === 'confluence');
  assert.equal(confluence.knowledgeSource, true); assert.deepEqual(confluence.usedFor.map(use => use.label), ['Knowledge']);
  assert.equal(identity.knowledgeSource, false);
  const databricks = cards.find(card => card.id === 'databricks');
  assert.deepEqual(databricks.usedFor, []); assert.equal(databricks.connectionKind, 'mcp');
});

test('REST API and command-line connections can be added from the page; secrets are referenced, not stored in yaml', async () => {
  const workspace = await newWorkspace();
  const secretStore = createSecretStore();
  const service = new ConnectorService({ workspace, secretStore });
  const api = await service.saveCustom({ kind: 'api', title: 'HR directory', description: 'Looks up employees by id.', baseUrl: 'https://hr.example.com/api/', auth: 'bearer', token: 'hr-secret' });
  assert.equal(api.id, 'hr-directory'); assert.equal(api.connectionKind, 'api'); assert.equal(api.endpoint, 'https://hr.example.com/api'); assert.equal(api.description, 'Looks up employees by id.'); assert.equal(api.origin, 'connectors');
  const operations = await workspace.readOperations();
  assert.deepEqual(operations.connections['hr-directory'], { kind: 'api', base_url: 'https://hr.example.com/api', auth: 'bearer', env: { HR_DIRECTORY_TOKEN: '${HR_DIRECTORY_TOKEN}' } });
  assert.equal(await secretStore.get('connectors/hr-directory/HR_DIRECTORY_TOKEN'), 'hr-secret');
  assert.equal((await fs.readFile(workspace.operationsPath, 'utf8')).includes('hr-secret'), false);
  assert.equal((await service.envForTasks()).HR_DIRECTORY_TOKEN, 'hr-secret');

  const cli = await service.saveCustom({ kind: 'cli', title: 'GitHub CLI', command: 'gh', args: '--repo acme/ops' });
  assert.equal(cli.connectionKind, 'cli'); assert.equal(cli.endpoint, 'gh --repo acme/ops');
  assert.deepEqual((await workspace.readOperations()).connections['github-cli'], { kind: 'cli', command: 'gh', args: ['--repo', 'acme/ops'] });

  const mcp = await service.saveCustom({ title: 'Runbook search', transport: 'http', url: 'https://runbooks.example.com/mcp' });
  assert.equal(mcp.connectionKind, 'mcp'); assert.equal(mcp.mcp.url, 'https://runbooks.example.com/mcp');

  await assert.rejects(service.saveCustom({ kind: 'api', title: 'Bad', baseUrl: 'ftp://nope' }), /Base URL/);
  await assert.rejects(service.saveCustom({ kind: 'cli', title: 'Bad', command: 'rm -rf /' }), /command name only/);
  await assert.rejects(service.saveCustom({ kind: 'soap', title: 'Bad' }), /kind must be/);
  assert.deepEqual((await workspace.validate()).errors.filter(error => /connection|secret/i.test(error)), []);

  // Removing a custom connection deletes the secrets it referenced.
  assert.equal(await service.remove('hr-directory'), true);
  assert.equal(await secretStore.get('connectors/hr-directory/HR_DIRECTORY_TOKEN').catch(() => undefined), undefined);
});

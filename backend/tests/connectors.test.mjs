import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ConnectorService } from '../src/connectors/connector-service.mjs';
import { catalog } from '../src/connectors/connector-catalog.mjs';
import { createWorkspace } from '../src/workspace/workspace.mjs';
import { createSecretStore } from '../src/secrets/secret-store.mjs';
import { mapIssue, adfToText } from '../src/connectors/jira/jira-service.mjs';
import { tempDir } from './helpers.mjs';

const tmp = await tempDir('nc-connectors-');

function fakeConnections() {
  const saved = new Map(); return { saved, async save(profile) { saved.set(profile.id, profile); return { ...profile, credentialConfigured: true }; }, async delete(id) { return saved.delete(id); }, async test(id) { return { id, lastTest: { status: saved.has(id) ? 'connected' : 'failed', message: saved.has(id) ? 'Connected.' : 'Missing' } }; }, async providerStatuses() { return [...saved.values()].map(profile => ({ id: profile.provider, provider: profile.provider, configured: true, ready: true, verified: true })); } };
}

test('catalog exposes the connector cards without internals', () => {
  const cards = catalog();
  assert.deepEqual(cards.map(card => card.id), ['databricks', 'servicenow', 'atlassian', 'github', 'snowflake', 'sharepoint', 'email', 'custom']);
  assert.ok(cards.every(card => !('mcp' in card) && !('cli' in card) && !('managedProfile' in card)));
  assert.deepEqual(cards[2].secrets, [{ key: 'apiToken', label: 'API token', env: 'JIRA_API_TOKEN', required: true }]);
});

test('saving a connector writes the MCP entry with env references, stores the secret, and creates the managed profile', async () => {
  const workspace = await createWorkspace({ dir: path.join(tmp, 'ws') });
  const secretStore = createSecretStore(); const connectionService = fakeConnections();
  const service = new ConnectorService({ workspace, secretStore, connectionService });
  await assert.rejects(service.save('atlassian', { settings: { site: 'company.atlassian.net' }, secrets: {} }), /Account email is required/);
  await assert.rejects(service.save('atlassian', { settings: { site: 'company.atlassian.net', email: 'me@company.com' }, secrets: {} }), /API token is required/);
  const card = await service.save('atlassian', { settings: { site: 'company.atlassian.net', email: 'me@company.com', project: 'DATAOPS' }, secrets: { apiToken: 'secret-token-123' } });
  assert.equal(card.state, 'connected'); assert.deepEqual(card.secretsSet, ['JIRA_API_TOKEN']); assert.equal(card.settings.site, 'https://company.atlassian.net');
  const operations = await workspace.readOperations();
  assert.deepEqual(operations.connections.atlassian, { kind: 'mcp', transport: 'stdio', command: 'uvx', args: ['mcp-atlassian'], env: { JIRA_URL: '${JIRA_URL}', JIRA_USERNAME: '${JIRA_USERNAME}', JIRA_API_TOKEN: '${JIRA_API_TOKEN}' }, enabled: true });
  assert.equal(operations.ticketing.platform, 'jira'); assert.equal(operations.ticketing.scope.project, 'DATAOPS');
  assert.equal(JSON.stringify(operations).includes('secret-token-123'), false, 'secrets never enter operations.yaml');
  assert.deepEqual((await workspace.readMcp()).mcpServers.atlassian, { type: 'stdio', command: 'uvx', args: ['mcp-atlassian'], env: { JIRA_URL: '${JIRA_URL}', JIRA_USERNAME: '${JIRA_USERNAME}', JIRA_API_TOKEN: '${JIRA_API_TOKEN}' } });
  const profile = connectionService.saved.get('jira-nervecenter');
  assert.equal(profile.provider, 'jira'); assert.deepEqual(profile.credentials, { apiToken: 'secret-token-123' }); assert.equal(profile.config.email, 'me@company.com');
  const env = await service.envForTasks();
  assert.deepEqual(env, { JIRA_URL: 'https://company.atlassian.net', JIRA_USERNAME: 'me@company.com', JIRA_API_TOKEN: 'secret-token-123' });
  // re-saving without the secret keeps the stored one; an MCP override is honoured
  const again = await service.save('atlassian', { settings: { site: 'https://company.atlassian.net', email: 'me@company.com' }, secrets: {}, mcp: { transport: 'http', url: 'https://mcp.atlassian.com/v1/mcp' } });
  assert.equal(again.mcp.transport, 'http'); assert.equal(again.mcp.url, 'https://mcp.atlassian.com/v1/mcp');
  assert.equal((await service.envForTasks()).JIRA_API_TOKEN, 'secret-token-123');
  const custom = await service.saveCustom({ title: 'Runbook search', transport: 'stdio', command: 'npx', args: '-y @acme/runbooks-mcp', env: { RUNBOOKS_TOKEN: 'abc', RUNBOOKS_URL: 'https://runbooks.internal' } });
  assert.equal(custom.id, 'runbook-search'); assert.equal(custom.kind, 'custom'); assert.deepEqual(custom.mcp.args, ['-y', '@acme/runbooks-mcp']); assert.deepEqual(custom.mcp.env, ['RUNBOOKS_TOKEN', 'RUNBOOKS_URL']);
  assert.equal((await service.envForTasks()).RUNBOOKS_TOKEN, 'abc');
  const list = await service.list();
  assert.deepEqual(list.map(card => [card.id, card.state]), [['databricks', 'not_connected'], ['servicenow', 'not_connected'], ['atlassian', 'connected'], ['github', 'not_connected'], ['snowflake', 'not_connected'], ['sharepoint', 'not_connected'], ['email', 'not_connected'], ['runbook-search', 'connected']]);
  assert.equal(await service.remove('runbook-search'), true);
  assert.equal((await service.envForTasks()).RUNBOOKS_TOKEN, undefined);
  assert.equal(await service.remove('atlassian'), true);
  assert.equal(connectionService.saved.has('jira-nervecenter'), false);
});

test('the GitHub connector configures source control and keeps its token out of operations.yaml', async () => {
  const workspace = await createWorkspace({ dir: path.join(tmp, 'ws-github') });
  const secretStore = createSecretStore();
  const service = new ConnectorService({ workspace, secretStore, connectionService: fakeConnections() });
  const card = await service.save('github', { settings: { repository: 'acme/widgets', defaultBranch: 'develop' }, secrets: { token: 'github-secret-token' } });
  assert.equal(card.state, 'connected'); assert.deepEqual(card.secretsSet, ['GITHUB_TOKEN']);
  const operations = await workspace.readOperations();
  assert.deepEqual(operations.connections.github, { kind: 'cli', command: 'gh', env: { GITHUB_TOKEN: '${GITHUB_TOKEN}' }, enabled: true });
  assert.deepEqual(Object.fromEntries(['platform', 'connection', 'repository', 'default_branch'].map(key => [key, operations.source_control[key]])), { platform: 'github', connection: 'github', repository: 'acme/widgets', default_branch: 'develop' });
  assert.equal(JSON.stringify(operations).includes('github-secret-token'), false);
  assert.deepEqual(await service.envForTasks(), { GITHUB_TOKEN: 'github-secret-token' });
});

test('the Databricks connector connects as a person or as a service principal, and switching forgets the other credential', async () => {
  const workspace = await createWorkspace({ dir: path.join(tmp, 'ws-databricks') });
  const secretStore = createSecretStore(); const connectionService = fakeConnections();
  const service = new ConnectorService({ workspace, secretStore, connectionService });

  // A person: the access token is required, the service principal fields are not asked for.
  await assert.rejects(service.save('databricks', { settings: { host: 'adb-1.azuredatabricks.net' }, secrets: {} }), /Personal access token is required/);
  const pat = await service.save('databricks', { settings: { host: 'adb-1.azuredatabricks.net' }, secrets: { token: 'dapi-person-token' } });
  assert.equal(pat.state, 'connected'); assert.deepEqual(pat.secretsSet, ['DATABRICKS_TOKEN']); assert.equal(pat.settings.authMode, 'pat');
  assert.deepEqual(connectionService.saved.get('databricks-nervecenter').credentials, { token: 'dapi-person-token' });
  assert.deepEqual(await service.envForTasks(), { DATABRICKS_HOST: 'https://adb-1.azuredatabricks.net', DATABRICKS_TOKEN: 'dapi-person-token' });

  // A service principal: the client ID and secret take over, and the access token is not accepted in its place.
  await assert.rejects(service.save('databricks', { settings: { host: 'adb-1.azuredatabricks.net', authMode: 'service_principal' }, secrets: {} }), /Client ID is required/);
  await assert.rejects(service.save('databricks', { settings: { host: 'adb-1.azuredatabricks.net', authMode: 'service_principal', clientId: 'sp-client' }, secrets: {} }), /Client secret \(OAuth\) is required/);
  await assert.rejects(service.save('databricks', { settings: { host: 'adb-1.azuredatabricks.net', authMode: 'shouting' }, secrets: {} }), /Authenticate as must be one of/);
  const sp = await service.save('databricks', { settings: { host: 'adb-1.azuredatabricks.net', authMode: 'service_principal', clientId: 'sp-client', warehouseId: 'wh-1' }, secrets: { clientSecret: 'dose-secret' } });
  assert.deepEqual(sp.secretsSet, ['DATABRICKS_CLIENT_SECRET'], 'the personal access token is forgotten, not left behind for the agent');
  assert.deepEqual(connectionService.saved.get('databricks-nervecenter').credentials, { clientId: 'sp-client', clientSecret: 'dose-secret' });

  const operations = await workspace.readOperations();
  assert.deepEqual(operations.connections.databricks.env, { DATABRICKS_HOST: '${DATABRICKS_HOST}', DATABRICKS_CLIENT_ID: '${DATABRICKS_CLIENT_ID}', DATABRICKS_WAREHOUSE_ID: '${DATABRICKS_WAREHOUSE_ID}', DATABRICKS_CLIENT_SECRET: '${DATABRICKS_CLIENT_SECRET}' });
  assert.equal(JSON.stringify(operations).includes('dose-secret'), false, 'secrets never enter operations.yaml');
  assert.deepEqual(await service.envForTasks(), { DATABRICKS_HOST: 'https://adb-1.azuredatabricks.net', DATABRICKS_CLIENT_ID: 'sp-client', DATABRICKS_WAREHOUSE_ID: 'wh-1', DATABRICKS_CLIENT_SECRET: 'dose-secret' });
  assert.equal((await service.envForTasks()).DATABRICKS_TOKEN, undefined);
});

test('the email connector saves an SMTP connection, the mail settings, and only the secrets given', async () => {
  const workspace = await createWorkspace({ dir: path.join(tmp, 'ws-mail') });
  const service = new ConnectorService({ workspace, secretStore: createSecretStore() });
  await assert.rejects(service.save('email', { settings: { server: 'smtp.company.com' } }), /Send as is required/);
  const card = await service.save('email', { settings: { server: 'smtp.company.com', port: '587', sender: 'dataops@company.com', domains: 'company.com, @Company.co.uk' }, secrets: { password: 'app-password' } });
  assert.equal(card.connectionKind, 'smtp'); assert.equal(card.hasMcpDefault, false); assert.deepEqual(card.secretsSet, ['SMTP_PASSWORD']);
  const operations = await workspace.readOperations();
  assert.deepEqual(operations.connections.email, { kind: 'smtp', env: { SMTP_HOST: '${SMTP_HOST}', SMTP_PORT: '${SMTP_PORT}', SMTP_PASSWORD: '${SMTP_PASSWORD}' }, enabled: true });
  const { platform, connection, sender, internal_domains: domains } = operations.communication;
  assert.deepEqual({ platform, connection, sender, domains }, { platform: 'smtp', connection: 'email', sender: 'dataops@company.com', domains: ['company.com', 'company.co.uk'] });
  assert.equal((await workspace.readMcp()).mcpServers?.email, undefined, 'SMTP is not an MCP server');
  assert.deepEqual(await service.envForTasks(), { SMTP_HOST: 'smtp.company.com', SMTP_PORT: '587', SMTP_PASSWORD: 'app-password' });
});

test('connectors still list when the secret store refuses reads, and saving reports the refusal', async () => {
  const denied = () => Object.assign(new Error('not authorized to perform: secretsmanager:GetSecretValue'), { name: 'AccessDeniedException' });
  const secretStore = { async get() { throw denied(); }, async has() { throw denied(); }, async set() { throw denied(); }, async delete() { throw denied(); } };
  const workspace = await createWorkspace({ dir: path.join(tmp, 'ws-denied') });
  const service = new ConnectorService({ workspace, secretStore, connectionService: fakeConnections() });
  const list = await service.list();
  assert.equal(list.find(card => card.id === 'databricks').state, 'not_connected');
  assert.ok(list.every(card => Array.isArray(card.secretsSet) && card.secretsSet.length === 0));
  await assert.rejects(service.save('databricks', { settings: { host: 'adb-1.azuredatabricks.net' }, secrets: { token: 'dapi-person-token' } }), /secretsmanager/);
});

test('jira issues map to tickets', () => {
  const ticket = mapIssue({ id: '10001', key: 'DATAOPS-1854', fields: { summary: 'customer_daily_refresh failed', description: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Run 123 failed at merge.' }] }] }, status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } }, priority: { name: 'Highest' }, issuetype: { name: 'Bug' }, project: { key: 'DATAOPS' }, labels: ['pipeline'], reporter: { displayName: 'Isha' }, assignee: null, created: '2026-09-23T08:00:00.000+0000', updated: '2026-09-23T09:00:00.000+0000' } }, 'https://company.atlassian.net');
  assert.equal(ticket.sourceKey, 'jira:10001'); assert.equal(ticket.externalReference.url, 'https://company.atlassian.net/browse/DATAOPS-1854'); assert.equal(ticket.priority, 'critical'); assert.equal(ticket.status, 'in_progress'); assert.equal(ticket.category, 'pipeline_failure'); assert.match(ticket.description, /Run 123 failed at merge/);
  assert.equal(adfToText({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }] }), 'ab\n');
});

test('api and cli connections written by the setup skill appear as their own kind and can be tested', async () => {
  const { createServer } = await import('node:http');
  const server = createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const workspace = await createWorkspace({ dir: path.join(tmp, `ws-kinds-${Math.random().toString(36).slice(2)}`) });
    const service = new ConnectorService({ workspace, secretStore: createSecretStore(), connectionService: fakeConnections() });
    await workspace.setConnection('mail', { kind: 'api', base_url: `http://127.0.0.1:${port}/mail`, auth: 'none' });
    await workspace.setConnection('git', { kind: 'cli', command: 'git' });
    await workspace.setConnection('nowhere', { kind: 'api', base_url: 'http://127.0.0.1:9/none' });
    const cards = await service.list();
    const mail = cards.find(card => card.id === 'mail'); const git = cards.find(card => card.id === 'git');
    assert.equal(mail.kind, 'custom'); assert.equal(mail.connectionKind, 'api'); assert.equal(mail.mcp, null); assert.equal(mail.settings.base_url, `http://127.0.0.1:${port}/mail`); assert.match(mail.description, /HTTP API/);
    assert.equal(git.connectionKind, 'cli'); assert.equal(git.settings.command, 'git'); assert.equal(git.mcp, null);
    assert.equal((await service.test('mail')).status, 'connected'); assert.equal((await service.test('git')).status, 'connected');
    assert.equal((await service.test('nowhere')).status, 'failed');
    // .mcp.json only carries MCP servers
    assert.deepEqual(Object.keys(JSON.parse(await fs.readFile(path.join(workspace.dir, '.mcp.json'), 'utf8')).mcpServers), []);
  } finally { server.close(); }
});

test('email from the environment: SMTP_HOST alone makes the card connected, and Test really connects to the server', async () => {
  const { createServer } = await import('node:net');
  const { smtpFromEnvironment } = await import('../src/connectors/connector-service.mjs');
  const relay = createServer(socket => { socket.write('220 relay ready\r\n'); socket.on('data', () => socket.end()); });
  await new Promise(resolve => relay.listen(0, '127.0.0.1', resolve));
  const port = relay.address().port;
  try {
    assert.deepEqual(smtpFromEnvironment({ SMTP_HOST: '10.121.0.205', SMTP_PORT: '25', SMTP_USE_TLS: 'false' }), { server: '10.121.0.205', port: '25', security: 'none' });
    // Defaults mirror the plugin's sender: plain SMTP on 25 unless SMTP_USE_TLS or SMTP_SECURITY says otherwise.
    assert.deepEqual(smtpFromEnvironment({ SMTP_HOST: 'smtp.office365.com' }), { server: 'smtp.office365.com', port: '25', security: 'none' });
    assert.deepEqual(smtpFromEnvironment({ SMTP_HOST: 'smtp.office365.com', SMTP_USE_TLS: 'true' }), { server: 'smtp.office365.com', port: '587', security: 'starttls' });
    assert.equal(smtpFromEnvironment({}), null);

    const workspace = await createWorkspace({ dir: path.join(tmp, 'ws-env-mail') });
    await workspace.setSection('communication', { platform: 'smtp', sender: 'mitesh.shinde@zs.com' });
    const env = { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(port), SMTP_USE_TLS: 'false' };
    const service = new ConnectorService({ workspace, secretStore: createSecretStore(), connectionService: fakeConnections(), env });
    const email = (await service.list()).find(card => card.id === 'email');
    assert.equal(email.state, 'connected'); assert.equal(email.source, 'environment');
    assert.deepEqual(email.settings, { server: '127.0.0.1', port: String(port), security: 'none', sender: 'mitesh.shinde@zs.com' });
    const ok = await service.test('email');
    assert.equal(ok.status, 'connected'); assert.match(ok.message, /from the environment/);

    // Nothing listening: the page says so in one sentence instead of a task discovering it 40 turns later.
    relay.close(); await new Promise(resolve => setTimeout(resolve, 50));
    const down = await service.test('email');
    assert.equal(down.status, 'failed'); assert.match(down.message, /refused the connection/);

    const bare = new ConnectorService({ workspace, secretStore: createSecretStore(), connectionService: fakeConnections(), env: {} });
    assert.equal((await bare.list()).find(card => card.id === 'email').state, 'not_connected');
    assert.equal((await bare.test('email')).status, 'failed');
  } finally { relay.close(); }
});

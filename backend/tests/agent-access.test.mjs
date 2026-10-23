import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileTaskStore } from '../src/tasks/task-store.mjs';
import { TaskRuntime } from '../src/tasks/task-runtime.mjs';
import { createWorkspace } from '../src/workspace/workspace.mjs';
import { agentEnv, canDecide, capPermission, referencedEnvNames } from '../src/tasks/agent-access.mjs';
import { classifyTool } from '../src/tasks/permission-policy.mjs';
import { TOOL_CATEGORIES } from '../src/tasks/nervecenter-tool-categories.mjs';
import { createAppTools, tablesIn } from '../src/tasks/nervecenter-tools.mjs';
import { sdkInit, sdkResult, tempDir, wait, pilot } from './helpers.mjs';

// Sonic acts for the person who asked: their role is the ceiling for what a task may do and for
// what they may approve, and the session never sees the backend's own secrets.

const tmp = await tempDir('nc-access-');
const viewer = { id: 'vera', name: 'Vera', role: 'viewer' };
const developer = { id: 'dev', name: 'Dev', role: 'developer' };
const admin = { id: 'ada', name: 'Ada', role: 'admin' };

test('a role caps the permission a task can have', () => {
  assert.equal(capPermission('allow', 'viewer'), 'read-only');
  assert.equal(capPermission('policy', 'viewer'), 'read-only');
  assert.equal(capPermission('allow', 'developer'), 'policy');
  assert.equal(capPermission('ask', 'developer'), 'ask');
  assert.equal(capPermission('allow', 'admin'), 'allow');
});

test('who may decide an approval', () => {
  assert.equal(canDecide('viewer', 'default_write'), false);
  assert.equal(canDecide('developer', 'production_changes'), true);
  assert.equal(canDecide('developer', 'privileged_access'), false, 'access changes need an admin');
  assert.equal(canDecide('developer', 'privileged_access', 'denied'), true, 'anyone who works tasks may say no');
  assert.equal(canDecide('admin', 'privileged_access'), true);
});

test('the session environment is an allowlist: connector variables in, backend secrets out', () => {
  const env = agentEnv({ PATH: '/bin', ANTHROPIC_API_KEY: 'k', DATABASE_URL: 'postgres://x', OPS_TRUSTED_IDENTITY_TOKEN: 't', OPS_SECRET_ENCRYPTION_KEY: 'e', AWS_SECRET_ACCESS_KEY: 'a', DATABRICKS_TOKEN: 'd', SMTP_HOST: 'mail', HTTPS_PROXY: 'p', UNRELATED: 'u' }, { referenced: referencedEnvNames({ connections: { databricks: { env: { DATABRICKS_TOKEN: '${DATABRICKS_TOKEN}' } } } }), extra: { GH_TOKEN: 'g' } });
  for (const name of ['PATH', 'ANTHROPIC_API_KEY', 'DATABRICKS_TOKEN', 'SMTP_HOST', 'HTTPS_PROXY', 'GH_TOKEN']) assert.ok(name in env, `${name} reaches the session`);
  for (const name of ['DATABASE_URL', 'OPS_TRUSTED_IDENTITY_TOKEN', 'OPS_SECRET_ENCRYPTION_KEY', 'AWS_SECRET_ACCESS_KEY', 'UNRELATED']) assert.ok(!(name in env), `${name} stays out`);
  // Running the model through Bedrock needs the AWS credentials.
  assert.ok('AWS_SECRET_ACCESS_KEY' in agentEnv({ CLAUDE_CODE_USE_BEDROCK: '1', AWS_SECRET_ACCESS_KEY: 'a' }));
});

test("a viewer's task is read-only, a developer cannot widen a task to allow, and approvals follow the role", async () => {
  const workspace = await createWorkspace({ dir: path.join(tmp, 'ws') });
  const store = new FileTaskStore(path.join(tmp, 'store')); await store.init();
  const sdk = { query({ options }) { return (async function* () {
    yield sdkInit('s');
    await options.canUseTool('Bash', { command: 'psql -c "GRANT SELECT ON t TO bob"' }, { signal: options.abortController.signal }).catch(() => null);
    yield sdkResult('s', 'Done');
  })(); } };
  const runtime = new TaskRuntime({ store, workspace, sdkLoader: async () => sdk });

  const viewerTask = await runtime.startTask({ scope: pilot, prompt: 'Look', user: viewer, permission: 'allow', notify: false });
  assert.equal(viewerTask.permission, 'read-only');
  await wait(async () => (await store.getTask(viewerTask.id)).status === 'done');
  assert.ok((await store.listEvents(viewerTask.id)).some(event => event.type === 'approval.denied'), 'the grant was refused in a read-only task');

  const devTask = await runtime.startTask({ scope: pilot, prompt: 'Grant', user: developer, permission: 'policy', notify: false });
  await assert.rejects(runtime.setPermission(devTask.id, developer, 'allow'), /developer can let Sonic go as far as policy/);
  let item;
  await wait(async () => { [item] = await store.listInbox(pilot, { kind: 'approval', taskId: devTask.id, status: 'pending' }); return Boolean(item); });
  assert.equal(item.category, 'privileged_access');
  await assert.rejects(runtime.decideApproval(item.id, 'approved', viewer), /Viewers cannot decide approvals/);
  await assert.rejects(runtime.decideApproval(item.id, 'approved', developer), /Only an admin can approve/);
  await runtime.decideApproval(item.id, 'approved', admin);
  await wait(async () => (await store.getTask(devTask.id)).status === 'done');
});

test('every nervecenter tool has a category, and an unknown one is a change', () => {
  const fakeSdk = { tool: (name, description, shape, handler, extra) => ({ name, shape, handler, extra }), createSdkMcpServer: ({ tools }) => ({ tools }) };
  const stub = { list: async () => [], save: async () => ({}), setEnabled: async () => ({}), run: async () => ({}), test: async () => ({}), sync: async () => ({}) };
  const server = createAppTools({ operationsService: {}, taskStore: {}, routines: stub, connectors: stub, knowledge: stub, boards: { preview: async () => ({ columns: [], rows: [] }) }, knowledgeDrafts: {} })({ id: 'T-9', projectId: 'pilot', createdBy: admin }, fakeSdk);
  for (const item of server.tools) {
    assert.ok(TOOL_CATEGORIES[item.name], `${item.name} has a category`);
    assert.equal(item.extra.annotations.readOnlyHint, TOOL_CATEGORIES[item.name] === 'read', `${item.name} read-only hint matches its category`);
  }
  for (const name of ['update_ticket', 'save_routine', 'run_routine', 'set_routine_enabled', 'list_connections', 'query_data', 'show_lineage', 'show_change', 'sync_knowledge_base']) assert.ok(server.tools.some(item => item.name === name), `${name} is offered`);
  assert.equal(classifyTool('mcp__nervecenter__made_up_tool', {}, { permission: 'read-only' }).verdict, 'deny', 'an unknown app tool is not a read');
  assert.equal(classifyTool('mcp__nervecenter__delete_board', { board: 'B-1' }, { permission: 'policy' }).verdict, 'ask', 'deleting a board asks by default');
});

test('the query card knows which tables a SELECT read', () => {
  assert.deepEqual(tablesIn('SELECT a FROM commercial.gold.sales s JOIN `ref`.`territory` t ON s.id = t.id -- FROM nothing'), ['commercial.gold.sales', 'ref.territory']);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createWorkspace, validateOperations } from '../src/workspace/workspace.mjs';
import { tempDir } from './helpers.mjs';

const tmp = await tempDir('nc-workspace-');

test('init seeds operations.yaml from the plugin template and creates the layout', async () => {
  const ws = await createWorkspace({ dir: path.join(tmp, 'ws') });
  const operations = await ws.readOperations();
  assert.ok('team' in operations && 'connections' in operations && 'policy' in operations);
  for (const dir of ['knowledge', 'workflows', 'tasks', '.claude/skills']) assert.ok(await fs.stat(path.join(ws.dir, dir)));
  assert.match(await fs.readFile(path.join(ws.dir, 'CLAUDE.md'), 'utf8'), /operations\.yaml/);
  assert.deepEqual(await ws.readMcp(), { mcpServers: {} });
  const text = await ws.readOperationsText();
  assert.match(text, /^# Operations workspace setup/);
});

test('connections round-trip into operations.yaml and .mcp.json, comments survive', async () => {
  const ws = await createWorkspace({ dir: path.join(tmp, 'ws') });
  await ws.setConnection('Atlassian', { kind: 'mcp', transport: 'http', url: 'https://mcp.atlassian.com/v1/mcp' });
  await ws.setConnection('servicenow', { kind: 'mcp', transport: 'stdio', command: 'npx', args: ['-y', '@servicenow/mcp'], env: { SERVICENOW_INSTANCE: '${SERVICENOW_INSTANCE}' } });
  await ws.setConnection('github', { kind: 'cli', command: 'gh' });
  const mcp = await ws.readMcp();
  assert.deepEqual(mcp, { mcpServers: { atlassian: { type: 'http', url: 'https://mcp.atlassian.com/v1/mcp' }, servicenow: { type: 'stdio', command: 'npx', args: ['-y', '@servicenow/mcp'], env: { SERVICENOW_INSTANCE: '${SERVICENOW_INSTANCE}' } } } });
  assert.equal((await ws.listConnections()).length, 3);
  assert.match(await ws.readOperationsText(), /# Simple authority boundaries/);
  assert.equal(await ws.removeConnection('github'), true);
  assert.equal(await ws.removeConnection('github'), false);
  await assert.rejects(ws.setConnection('bad', { kind: 'mcp', transport: 'http' }), /requires url/);
});

test('sections and validation', async () => {
  const ws = await createWorkspace({ dir: path.join(tmp, 'ws') });
  let result = await ws.validate();
  assert.ok(result.errors.includes('team.name is required'));
  await ws.setSection('team', { name: 'Data Operations', timezone: 'Asia/Kolkata', operator: { name: 'Mitesh', email: 'mitesh@example.com' } });
  await ws.setSection('sync', { enabled: false });
  assert.deepEqual(await ws.getSection('sync'), { enabled: false });
  await ws.setSection('ticketing', { platform: 'jira', connection: 'atlassian', scope: { project: 'DATAOPS' } });
  result = await ws.validate();
  assert.deepEqual(result.errors, []);
  await ws.setSection('ticketing', { platform: 'jira', connection: 'missing' });
  assert.ok((await ws.validate()).errors.some(error => /unknown connection: missing/.test(error)));
  assert.ok(validateOperations({ team: { name: 'x', timezone: 'UTC' }, connections: { j: { kind: 'mcp', transport: 'http', url: 'u', headers: { authorization: 'Bearer abc123def456ghi789' } } } }).errors.length === 0);
  assert.ok(validateOperations({ team: { name: 'x', timezone: 'UTC' }, identity: { api_token: 'real-secret-value' } }).errors.some(error => /possible committed secret/.test(error)));
  await assert.rejects(ws.setSection('nope', {}), /Unknown operations.yaml section/);
});

test('routines are workflow files', async () => {
  const ws = await createWorkspace({ dir: path.join(tmp, 'ws') });
  const saved = await ws.saveRoutine('Daily ticket review', { objective: 'Review my assigned Jira tickets.', trigger: { type: 'schedule', timezone: 'Asia/Kolkata', expression: '0 9 * * 1-5' }, authority: { writes: 'denied' }, app: { result: 'tasks', notify: 'on_complete', enabled: true } });
  assert.equal(saved.name, 'daily-ticket-review'); assert.equal(saved.file, 'daily-ticket-review.yaml'); assert.equal(saved.success.length, 1);
  const list = await ws.listRoutines();
  assert.equal(list.length, 1); assert.equal(list[0].trigger.expression, '0 9 * * 1-5');
  assert.equal((await ws.getRoutine('daily-ticket-review')).objective, 'Review my assigned Jira tickets.');
  await assert.rejects(ws.saveRoutine('x', { objective: 'no trigger' }), /trigger is required/);
  assert.equal(await ws.deleteRoutine('daily-ticket-review'), true);
  assert.equal((await ws.listRoutines()).length, 0);
});

test('skills come from the plugin and from custom uploads; trees never escape their root', async () => {
  const ws = await createWorkspace({ dir: path.join(tmp, 'ws') });
  const plugin = await ws.listPluginSkills();
  assert.equal(plugin.length, 23);
  assert.ok(plugin.some(skill => skill.id === 'plugin:rca' && /root-cause/i.test(skill.description)));
  await fs.mkdir(path.join(ws.skillsDir, 'failure-summary'), { recursive: true });
  await fs.writeFile(path.join(ws.skillsDir, 'failure-summary', 'SKILL.md'), '---\nname: failure-summary\ndescription: Summarise a failure in one paragraph.\n---\n# Failure summary\n', 'utf8');
  const all = await ws.listSkills();
  assert.equal(all.length, 24); assert.equal(all.at(-1).origin, 'custom');
  const tree = await ws.tree(ws.skillDir('plugin:rca'));
  assert.ok(tree.some(item => item.name === 'SKILL.md' && item.type === 'file'));
  assert.ok(tree.some(item => item.name === 'references' && item.type === 'directory' && item.children.length >= 3));
  const file = await ws.readFile(ws.skillDir('plugin:rca'), 'SKILL.md');
  assert.match(file.content, /^---\r?\nname: rca/); // CRLF on a Windows checkout
  await assert.rejects(ws.readFile(ws.skillDir('plugin:rca'), '../../agents/orchestrator.md'), /escapes/);
  assert.throws(() => ws.skillDir('plugin:../agents'), /Invalid skill id/);
});

test('knowledge folders and the root index', async () => {
  const ws = await createWorkspace({ dir: path.join(tmp, 'ws') });
  await fs.mkdir(path.join(ws.knowledgeDir, 'runbooks'), { recursive: true });
  await fs.writeFile(path.join(ws.knowledgeDir, 'runbooks', 'index.md'), '---\ntype: Index\ntitle: Platform runbooks\ndescription: Recovery steps for every pipeline.\nstatus: stable\n---\n', 'utf8');
  await fs.mkdir(path.join(ws.knowledgeDir, 'definitions'), { recursive: true });
  const folders = await ws.writeKnowledgeIndex();
  assert.deepEqual(folders.map(item => [item.name, item.title, item.hasIndex]), [['definitions', 'definitions', false], ['runbooks', 'Platform runbooks', true]]);
  const index = await fs.readFile(path.join(ws.knowledgeDir, 'index.md'), 'utf8');
  assert.match(index, /- \[Platform runbooks\]\(runbooks\/index.md\): Recovery steps/);
  const dir = await ws.taskDir('T-1001');
  assert.ok(dir.startsWith(ws.tasksDir));
});

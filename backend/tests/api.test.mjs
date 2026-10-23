import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createBackend } from '../src/bootstrap.mjs';
import { createApiServer } from '../src/api/server.mjs';

let server; let base; let backend;
const headers = (user = 'alice') => ({ 'content-type': 'application/json', 'x-nervecenter-project': 'pilot', 'x-user-id': user, 'x-user-name': user });
const call = async (method, path, body, user) => {
  const response = await fetch(`${base}${path}`, { method, headers: headers(user), body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
};

test.before(async () => {
  backend = await createBackend();
  await backend.projectStore.addMember('pilot', 'alice', { id: 'test' });
  await backend.projectStore.addMember('pilot', 'val', { id: 'test' }, { role: 'viewer' });
  server = createApiServer(backend);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => new Promise(resolve => server.close(resolve)));

test('health and identity', async () => {
  const health = await call('GET', '/health');
  assert.equal(health.status, 200); assert.equal(health.body.ok, true); assert.equal(health.body.databricks.configurationRequired, true);
  const me = await call('GET', '/api/me');
  // SPEC-projects-03 FR-1: someone who signs in for the first time is an app viewer; their project role decides the rest.
  assert.equal(me.status, 200); assert.equal(me.body.user.id, 'alice'); assert.equal(me.body.role, 'viewer');
  const admin = await call('GET', '/api/me', undefined, 'mitesh.shinde@zs.com');
  assert.equal(admin.body.role, 'admin');
});

test('Express edge preserves preflight, task SSE, and raw task file responses', async () => {
  const preflight = await fetch(`${base}/api/tasks/stream/events`, { method: 'OPTIONS' });
  assert.equal(preflight.status, 200);
  assert.deepEqual(await preflight.json(), { ok: true });

  const taskId = 'express-edge-task';
  await backend.taskStore.createTask({ id: taskId, projectId: 'pilot', type: 'adhoc', status: 'running' });
  await backend.taskStore.appendEvent(taskId, { type: 'assistant.text', text: 'hello from the event log' });
  const taskDir = await (await backend.workspace.for('pilot')).taskDir(taskId);
  await fs.mkdir(taskDir, { recursive: true });
  await fs.writeFile(path.join(taskDir, 'result.txt'), 'raw file bytes');

  const response = await fetch(`${base}/api/tasks/${taskId}/events`, { headers: headers() });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /^text\/event-stream/);
  const reader = response.body.getReader();
  let stream = '';
  try {
    for (let index = 0; index < 4 && !stream.includes('event: task'); index += 1) {
      const chunk = await reader.read();
      if (chunk.done) break;
      stream += new TextDecoder().decode(chunk.value);
    }
  } finally {
    await reader.cancel();
  }
  assert.match(stream, /event: event\ndata: .*hello from the event log/s);
  assert.match(stream, /event: task\ndata: /);

  const raw = await fetch(`${base}/api/tasks/${taskId}/files/raw?path=result.txt`, { headers: headers() });
  assert.equal(raw.status, 200);
  assert.equal(raw.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal(await raw.text(), 'raw file bytes');
  await backend.taskStore.deleteTask(taskId);
});

test('tickets: create, list, comment, update, activity', async () => {
  const created = await call('POST', '/api/tickets', { title: 'Backfill HCP master', description: 'Missing prescribers', category: 'data', priority: 'high' });
  assert.equal(created.status, 201); assert.match(created.body.ticketId, /^OPS-\d+$/); assert.equal(created.body.priority, 'high'); assert.equal(created.body.assignee.id, 'alice');
  const id = created.body.ticketId;
  const list = await call('GET', '/api/tickets?status=active');
  assert.ok(list.body.items.some(item => item.ticketId === id));
  const detail = await call('GET', `/api/tickets/${id}`);
  assert.equal(detail.body.permissions.canComment, true); assert.ok(detail.body.approver);
  const comment = await call('POST', `/api/tickets/${id}/comments`, { body: 'Looking into it' });
  assert.equal(comment.status, 201); assert.equal(comment.body.event.type, 'ticket.comment');
  const updated = await call('PATCH', `/api/tickets/${id}`, { status: 'resolved', resolutionSummary: 'Backfilled' });
  assert.equal(updated.body.status, 'resolved'); assert.ok(updated.body.closedAt);
  const activity = await call('GET', `/api/tickets/${id}/activity`);
  assert.deepEqual(activity.body.items.map(item => item.type), ['ticket.status', 'ticket.comment', 'ticket.created']);
});

test('ticket input validation returns client errors over HTTP', async () => {
  const missingTitle = await call('POST', '/api/tickets', { description: 'Missing title' });
  assert.equal(missingTitle.status, 400);
  assert.match(missingTitle.body.error, /title is required/);

  const partialRun = await call('POST', '/api/tickets', { title: 'Incomplete pipeline ticket', pipelineId: 'pipe-1' });
  assert.equal(partialRun.status, 400);
  assert.match(partialRun.body.error, /pipelineId and runId must be provided together/);

  const ticket = await call('POST', '/api/tickets', { title: 'Input validation target' });
  assert.equal(ticket.status, 201);
  for (const [patch, message] of [
    [{ status: 'invented' }, /Invalid ticket status/],
    [{ assignee: 42 }, /assignee must be a user id/],
    [{ collaborators: 'alice' }, /collaborators must be an array/],
  ]) {
    const response = await call('PATCH', `/api/tickets/${ticket.body.ticketId}`, patch);
    assert.equal(response.status, 400);
    assert.match(response.body.error, message);
  }

  const emptyComment = await call('POST', `/api/tickets/${ticket.body.ticketId}/comments`, { body: '   ' });
  assert.equal(emptyComment.status, 400);
  assert.match(emptyComment.body.error, /body is required/);
  const longComment = await call('POST', `/api/tickets/${ticket.body.ticketId}/comments`, { body: 'x'.repeat(10_001) });
  assert.equal(longComment.status, 400);
  assert.match(longComment.body.error, /10,000 characters or fewer/);

  const originalGetRun = backend.operationsService._getPlatformRun;
  backend.operationsService._getPlatformRun = async () => ({ status: 'succeeded' });
  try {
    const nonFailedRun = await call('POST', '/api/tickets', { title: 'Succeeded run', pipelineId: 'pipe-1', runId: 'run-1' });
    assert.equal(nonFailedRun.status, 409);
    assert.match(nonFailedRun.body.error, /only for failed pipeline runs/);
  } finally {
    backend.operationsService._getPlatformRun = originalGetRun;
  }
});

test('pipeline pages report the missing platform instead of failing the overview', async () => {
  const overview = await call('GET', '/api/overview');
  assert.equal(overview.status, 200); assert.equal(overview.body.capabilities.pipelineMonitoring.available, false); assert.equal(overview.body.ticketSummary.open + overview.body.ticketSummary.closed >= 1, true);
  const monitor = await call('GET', '/api/monitor');
  assert.equal(monitor.status, 400); assert.match(monitor.body.error, /No pipeline platform is connected/);
  const notifications = await call('GET', '/api/notifications');
  assert.equal(notifications.status, 200); assert.ok(notifications.body.system.some(item => item.provider === 'databricks'));
  const dq = await call('GET', '/api/data-quality/monitor');
  assert.equal(dq.status, 200); assert.equal(dq.body.configured, false);
});

test('SPEC-platform-15 FR-5: monitor validates and forwards bounded server page filters over HTTP', async () => {
  const original = backend.operationsService.monitor;
  let received;
  backend.operationsService.monitor = async options => { received = options; return { items: [{ pipelineId: 'target-1' }], total: 37, workspaceTotal: 1205, summary: { failed: 37 } }; };
  try {
    const page = await call('GET', '/api/monitor?limit=25&offset=50&status=Failed&platform=databricks&q=target&sort=name&dir=desc');
    assert.equal(page.status, 200);
    assert.equal(page.body.total, 37);
    assert.deepEqual({ limit: received.pageLimit, offset: received.offset, status: received.status, platform: received.platform, q: received.q, sort: received.sort, dir: received.dir }, { limit: 25, offset: 50, status: 'Failed', platform: 'databricks', q: 'target', sort: 'name', dir: 'desc' });
    assert.equal(received.limit, 5000);
    assert.equal((await call('GET', '/api/monitor?limit=101')).status, 400);
    assert.equal((await call('GET', '/api/monitor?offset=-1')).status, 400);
    const focus = await call('GET', `/api/monitor?pipelineId=${'x'.repeat(257)}`);
    assert.equal(focus.status, 400);
  } finally { backend.operationsService.monitor = original; }
});

test('manual Overview groups are scoped, independent and reject invalid windows', async () => {
  for (const group of ['tickets', 'work', 'agent', 'data-quality', 'pipelines']) {
    const result = await call('GET', `/api/overview/${group}`);
    assert.equal(result.status, 200, `${group}: ${JSON.stringify(result.body)}`);
    assert.equal(typeof result.body.generatedAt, 'string');
  }
  assert.equal((await call('GET', '/api/overview/tickets?from=invalid')).status, 400);
  const summary = await call('GET', '/api/notifications?mode=summary');
  assert.equal(summary.status, 200);
  assert.equal(typeof summary.body.unread, 'number');
  assert.equal('items' in summary.body, false);
  const page = await call('GET', '/api/notifications?mode=page&view=agent&limit=50');
  assert.equal(page.status, 200);
  assert.ok(page.body.items.every(item => item.kind.startsWith('agent.')));
});

test('SPEC-platform-07 FR-3/FR-4: API errors have stable codes and do not expose unexpected failures', async () => {
  const invalid = await fetch(`${base}/api/tasks`, { method: 'POST', headers: headers(), body: '{"prompt":' });
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { error: 'Request body must be valid JSON.', code: 'INVALID_REQUEST' });

  const oversized = await fetch(`${base}/api/tasks`, { method: 'POST', headers: headers(), body: JSON.stringify({ prompt: 'x'.repeat(8 * 1024 * 1024) }) });
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).code, 'PAYLOAD_TOO_LARGE');

  const original = backend.operationsService.monitor;
  const originalLog = console.error;
  let logged = false;
  backend.operationsService.monitor = async () => { throw new Error('private provider diagnostic'); };
  console.error = () => { logged = true; };
  try {
    const unexpected = await call('GET', '/api/monitor');
    assert.equal(unexpected.status, 500);
    assert.deepEqual(unexpected.body, { error: 'The request could not be completed.', code: 'INTERNAL_ERROR' });
    assert.equal(logged, true);
  } finally {
    backend.operationsService.monitor = original;
    console.error = originalLog;
  }
});

test('settings read and write operations.yaml (admin only)', async () => {
  const denied = await call('PUT', '/api/settings/team', { name: 'Ops', timezone: 'UTC' });
  assert.equal(denied.status, 403);
  const saved = await call('PUT', '/api/settings/team', { name: 'Data Operations', timezone: 'Asia/Kolkata' }, 'mitesh.shinde@zs.com');
  assert.equal(saved.status, 200); assert.equal(saved.body.value.timezone, 'Asia/Kolkata');
  const settings = await call('GET', '/api/settings');
  assert.equal(settings.status, 200); assert.equal(settings.body.operations.team.name, 'Data Operations'); assert.deepEqual(settings.body.mcp, { mcpServers: {} });
});

test('tasks and inbox routes exist and validate input', async () => {
  const list = await call('GET', '/api/tasks');
  assert.equal(list.status, 200); assert.deepEqual(list.body.items, []);
  const bad = await call('POST', '/api/tasks', { prompt: '' });
  assert.equal(bad.status, 400); assert.match(bad.body.error, /prompt is required/);
  const inbox = await call('GET', '/api/inbox');
  assert.equal(inbox.status, 200); assert.equal(inbox.body.pending, 0);
  const missing = await call('GET', '/api/tasks/T-999');
  assert.equal(missing.status, 403, 'a missing id answers like one in another project (FR-13)');
  const noTicket = await call('POST', '/api/tickets/OPS-404/investigate', {});
  assert.equal(noTicket.status, 403);
});

test('routines routes', async () => {
  const empty = await call('GET', '/api/routines');
  assert.equal(empty.status, 200); assert.deepEqual(empty.body.items, []);
  const created = await call('POST', '/api/routines', { title: 'Check failed pipelines', objective: 'Look for failed pipeline runs and summarise them.', schedule: { kind: 'hours', everyHours: 2, timezone: 'UTC' }, permission: 'read-only' });
  assert.equal(created.status, 201); assert.equal(created.body.name, 'check-failed-pipelines'); assert.equal(created.body.scheduleText, 'Every 2 hours');
  const check = await call('POST', '/api/routines/check-failed-pipelines/check');
  assert.equal(check.status, 200); assert.ok(Array.isArray(check.body.checks));
  const paused = await call('POST', '/api/routines/check-failed-pipelines/pause');
  assert.equal(paused.body.status, 'paused');
  const removed = await call('DELETE', '/api/routines/check-failed-pipelines');
  assert.equal(removed.body.deleted, true);
});

test('connectors routes', async () => {
  const cards = await call('GET', '/api/connectors');
  assert.equal(cards.status, 200); assert.deepEqual(cards.body.items.map(card => card.id), ['databricks', 'servicenow', 'atlassian', 'github', 'snowflake', 'sharepoint', 'email']);
  const denied = await call('PUT', '/api/connectors/atlassian', { settings: { site: 'x.atlassian.net', email: 'a@b.c' }, secrets: { apiToken: 't' } });
  assert.equal(denied.status, 403);
  const jira = await call('GET', '/api/integrations/jira/status');
  assert.equal(jira.status, 200); assert.equal(jira.body.ready, false);
});

test('skills and knowledge routes', async () => {
  const skills = await call('GET', '/api/skills');
  assert.equal(skills.status, 200); assert.equal(skills.body.items.length, 23); assert.ok(skills.body.items.every(skill => skill.origin === 'plugin'));
  const tree = await call('GET', '/api/skills/plugin%3Arca/tree');
  assert.equal(tree.status, 200); assert.ok(tree.body.items.some(item => item.name === 'SKILL.md'));
  const file = await call('GET', '/api/skills/plugin%3Arca/file?path=SKILL.md');
  assert.equal(file.status, 200); assert.match(file.body.content, /name: rca/);
  // SPEC-projects-03 FR-6: a project viewer cannot add skills or knowledge; a project developer reaches the upload checks.
  assert.equal((await call('POST', '/api/skills/upload', { zipBase64: 'AAAA' }, 'val')).status, 403);
  assert.equal((await call('POST', '/api/skills/upload', { zipBase64: 'AAAA' })).status, 400);
  const knowledge = await call('GET', '/api/knowledge');
  assert.equal(knowledge.status, 200); assert.deepEqual(knowledge.body.items, []); assert.equal(knowledge.body.mcp.mode, 'local');
  assert.equal((await call('POST', '/api/knowledge', { url: 'https://example.com/x.git' }, 'val')).status, 403);
  // Uploads need knowledge.manage in the project; a body larger than the default request limit still reaches the upload checks.
  const docs = [{ name: 'runbook.md', data: Buffer.from('# Runbook\n').toString('base64') }];
  assert.equal((await call('POST', '/api/knowledge/upload', { title: 'Docs', files: docs }, 'val')).status, 403);
  assert.equal((await call('POST', '/api/knowledge/docs/documents', { files: docs }, 'val')).status, 403);
  const admin = 'mitesh.shinde@zs.com';
  const wrongType = await call('POST', '/api/knowledge/upload', { title: 'Docs', files: [{ name: 'tool.exe', data: Buffer.alloc(9 * 1024 * 1024, 1).toString('base64') }] }, admin);
  assert.equal(wrongType.status, 400); assert.match(wrongType.body.error, /not a supported document/);
  const missing = await call('POST', '/api/knowledge/nope/documents', { files: docs }, admin);
  assert.equal(missing.status, 404);
});

test('removed control-plane routes are gone', async () => {
  for (const path of ['/api/registry/agents', '/api/workflows', '/api/runs', '/api/workbench/sessions', '/api/approvals', '/api/optimus/sessions', '/api/knowledge/bundles', '/api/skills/catalog', '/api/assistant/session']) {
    const response = await call('GET', path);
    assert.equal(response.status, 404, path);
  }
});

test('admin routes stay admin-only however the path is spelled', async () => {
  for (const [method, path] of [['PUT', '/api/secrets/demo'], ['PUT', '/api/secrets/demo/'], ['PUT', '/api//secrets/demo'], ['POST', '/api/integrations/jira/sync/'], ['POST', '/api/tickets/poll/'], ['GET', '/api/admin//rbac/users']]) {
    assert.equal((await call(method, path, method === 'GET' ? undefined : { value: 'x' })).status, 403, `${method} ${path}`);
  }
  assert.equal((await call('GET', '/api/admin/rbac/users/')).status, 403);
});

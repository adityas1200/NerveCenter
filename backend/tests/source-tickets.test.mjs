import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ServiceNowService } from '../src/connectors/servicenow/servicenow-service.mjs';
import { JiraService } from '../src/connectors/jira/jira-service.mjs';
import { FileOperationsStore } from '../src/app/operations-store.mjs';
import { OperationsService } from '../src/app/operations-service.mjs';
import { pilot, tempDir } from './helpers.mjs';

// SPEC-tickets-07: NerveCenter opens a ticket in ServiceNow or Jira once per alert, keyed so a retry finds the first one.

const tmp = await tempDir('nc-source-tickets-');
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

function fakeServiceNow() {
  const incidents = []; const posts = [];
  const fetchFn = async (url, init = {}) => {
    const target = new URL(String(url));
    if (init.method === 'POST' && target.pathname === '/api/now/table/incident') {
      const body = JSON.parse(init.body); posts.push(body);
      const row = { sys_id: `sys${incidents.length + 1}`, number: `INC00${incidents.length + 1}`, short_description: body.short_description, description: body.description, priority: body.priority, correlation_id: body.correlation_id, state: 'New' };
      incidents.push(row); return json({ result: row }, 201);
    }
    if (target.pathname === '/api/now/table/incident') {
      const wanted = /correlation_id=([^^]+)/.exec(target.searchParams.get('sysparm_query') || '')?.[1];
      return json({ result: incidents.filter(row => !wanted || row.correlation_id === wanted) });
    }
    return json({ result: [] });
  };
  const service = new ServiceNowService({ fetchFn, environment: false, secretStore: { get: async () => JSON.stringify({ username: 'svc', password: 'pw' }) }, connectionService: { getDefault: async () => ({ id: 'sn-1', config: { instance: 'https://example.service-now.com' } }), getRaw: async () => ({ id: 'sn-1', secretRef: 'connections/sn-1/credentials' }) } });
  return { service, posts, incidents };
}

function fakeJira({ refusePriority = false } = {}) {
  const issues = []; const posts = [];
  const fetchFn = async (url, init = {}) => {
    const target = new URL(String(url)); const body = init.body ? JSON.parse(init.body) : null;
    if (init.method === 'POST' && target.pathname === '/rest/api/3/issue') {
      posts.push(body);
      if (refusePriority && body.fields.priority) return json({ errors: { priority: 'Field priority cannot be set.' } }, 400);
      const issue = { id: String(100 + issues.length), key: `DATA-${issues.length + 1}`, fields: { ...body.fields, status: { name: 'To Do', statusCategory: { key: 'new' } } } };
      issues.push(issue); return json({ id: issue.id, key: issue.key }, 201);
    }
    if (target.pathname === '/rest/api/3/search/jql') {
      const label = /labels = "([^"]+)"/.exec(body.jql)?.[1]; const key = /key in \(([^)]+)\)/.exec(body.jql)?.[1];
      return json({ issues: issues.filter(issue => (label ? issue.fields.labels.includes(label) : true) && (key ? issue.key === key : true)), isLast: true });
    }
    return json({});
  };
  const service = new JiraService({ fetchFn, secretStore: { get: async () => JSON.stringify({ apiToken: 'jira-token' }) }, connectionService: { getDefault: async () => ({ id: 'jira-1', config: { site: 'https://company.atlassian.net', email: 'me@company.com', project: 'DATA' } }), getRaw: async () => ({ id: 'jira-1', secretRef: 'connections/jira-1/credentials' }) } });
  return { service, posts, issues };
}

test('FR-1: ServiceNow gets one incident with the alert in correlation_id and the priority as a display value', async () => {
  const { service, posts } = fakeServiceNow();
  const incident = await service.createIncident({ title: 'Pipeline sales_load failed', description: 'Run r1 failed', priority: '2 - High', assignmentGroup: 'Data Ops', correlationId: 'AL-1' });
  assert.deepEqual([incident.externalReference.number, incident.sourceKey], ['INC001', 'servicenow:sys1']);
  assert.deepEqual([posts[0].correlation_id, posts[0].priority, posts[0].assignment_group], ['AL-1', '2 - High', 'Data Ops']);
  assert.equal((await service.findByCorrelation('AL-1')).externalReference.number, 'INC001');
  assert.equal(await service.findByCorrelation('AL-2'), null);
  await assert.rejects(service.createIncident({ title: '' }), /title is required/);
});

test('FR-1: Jira gets one issue labelled with the alert, and a project that refuses priority still gets the issue', async () => {
  const { service, posts } = fakeJira({ refusePriority: true });
  const issue = await service.createIssue({ title: 'DQ checks failed on sales', description: 'Two checks failed', priority: 'High', label: 'nc-AL-9' });
  assert.equal(issue.externalReference.number, 'DATA-1');
  assert.deepEqual([posts.length, posts[0].fields.priority?.name, posts[1].fields.priority, posts[1].fields.project.key], [2, 'High', undefined, 'DATA']);
  assert.equal((await service.findByLabel('nc-AL-9')).externalReference.number, 'DATA-1');
  assert.equal(await service.findByLabel('bad label"'), null);
});

test('FR-2, FR-3: createSourceTicket tracks the incident here and a retry links the first one instead of opening another', async () => {
  const { service, posts } = fakeServiceNow();
  const store = new FileOperationsStore(path.join(tmp, 'ops-sn')); await store.init();
  const ops = new OperationsService({ store, serviceNow: service });
  const input = { scope: pilot, system: 'servicenow', title: 'Pipeline sales_load failed', description: 'Run r1 failed', priority: 'critical', correlationKey: 'AL-1', extra: { alertId: 'AL-1', pipelineId: '42' } };
  const ticket = await ops.createSourceTicket(input);
  assert.deepEqual([ticket.projectId, ticket.priority, ticket.externalReference.number, ticket.pipelineId, ticket.alertId, ticket.creator.id], ['pilot', 'critical', 'INC001', '42', 'AL-1', 'nervecenter-automation']);
  assert.equal(posts[0].priority, '1 - Critical');
  const again = await ops.createSourceTicket(input);
  assert.equal(again.ticketId, ticket.ticketId);
  assert.equal(posts.length, 1);
  await assert.rejects(ops.createSourceTicket({ ...input, system: 'email' }), /servicenow or jira/);
  await assert.rejects(ops.createSourceTicket({ ...input, system: 'jira' }), /Jira is not connected/);
});

test('FR-5, FR-6: system notes and resolves are signed by Sonic and written back to the source', async () => {
  const { service, posts } = fakeServiceNow();
  const writes = [];
  service.updateIncident = async (sysId, fields) => { writes.push({ sysId, fields }); return { ok: true }; };
  service.addWorkNote = async (sysId, text) => { writes.push({ sysId, note: text }); return { ok: true }; };
  const store = new FileOperationsStore(path.join(tmp, 'ops-notes')); await store.init();
  const ops = new OperationsService({ store, serviceNow: service });
  const ticket = await ops.createSourceTicket({ scope: pilot, system: 'servicenow', title: 'Late run', description: 'Slot 07:00 missed', correlationKey: 'AL-7' });
  assert.equal(posts.length, 1);
  const noted = await ops.systemNote(ticket.ticketId, 'Sonic started investigating.');
  assert.equal(noted.event.actor.id, 'nervecenter-automation');
  const activity = (await store.getTicket(ticket.ticketId)).activity;
  assert.ok(activity.some(event => event.detail === 'Sonic started investigating.'));
  assert.equal(await ops.systemNote(ticket.ticketId, '   '), null);
  await assert.rejects(ops.systemNote('NC-NOPE', 'x'), error => error.statusCode === 404);
  const plain = await ops.createTicket({ title: 'Pipeline late', scope: pilot, creator: { type: 'system', id: 'nervecenter-automation' } });
  await ops.systemResolve(plain.ticketId, 'Recovered: the 07:30 run started on time.');
  const resolved = await store.getTicket(plain.ticketId);
  assert.deepEqual([resolved.status, resolved.resolutionSummary], ['resolved', 'Recovered: the 07:30 run started on time.']);
  assert.equal(await ops.systemResolve(plain.ticketId, 'again'), null);
});

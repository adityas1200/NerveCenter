import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { ChangeFeed } from '../src/events/change-feed.mjs';
import { changeRoutes } from '../src/api/change-routes.mjs';
import { createApiServer } from '../src/api/server.mjs';
import { FileOperationsStore } from '../src/app/operations-store.mjs';
import { OperationsService } from '../src/app/operations-service.mjs';
import { pilot } from './helpers.mjs';

test('SPEC-platform-13 FR-1/FR-2: stream route is project-scoped and emits identifier-only hints', () => {
  const feed = new ChangeFeed();
  const [entry] = changeRoutes({ changeFeed: feed });
  assert.equal(entry.scope, 'project');
  assert.deepEqual(entry.methods, ['GET']);
  assert.equal(entry.needs, '*');

  const req = new EventEmitter();
  const res = new EventEmitter();
  const frames = [];
  res.writeHead = (status, headers) => { res.status = status; res.headers = headers; };
  res.write = frame => { frames.push(frame); return true; };
  entry.handler({ req, res, scope: { projectId: 'one', all: false, system: false } });
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /^text\/event-stream/);
  assert.match(frames[0], /^event: ready\ndata: \{"projectId":"one","at":/);
  assert.equal(feed.subscriberCount('one'), 1);

  feed.publish({ resource: 'ticket', id: 'OPS-1', projectId: 'one', title: 'must not escape' });
  feed.publish({ resource: 'ticket', id: 'OPS-2', projectId: 'two' });
  const change = frames.find(frame => frame.startsWith('event: change\n'));
  const data = JSON.parse(change.match(/^event: change\ndata: (.+)\n\n$/s)[1]);
  assert.deepEqual(Object.keys(data).sort(), ['at', 'id', 'projectId', 'resource']);
  assert.deepEqual({ resource: data.resource, id: data.id, projectId: data.projectId }, { resource: 'ticket', id: 'OPS-1', projectId: 'one' });
  assert.equal(frames.filter(frame => frame.startsWith('event: change\n')).length, 1);

  res.emit('close');
  assert.equal(feed.subscriberCount('one'), 0);
  assert.throws(() => entry.handler({ req: new EventEmitter(), res: new EventEmitter(), scope: { projectId: 'ALL', all: true } }), { statusCode: 403 });
});

test('ChangeFeed removes a subscriber whose response writer fails', () => {
  const feed = new ChangeFeed();
  feed.subscribe('broken', () => { throw new Error('response closed'); });
  feed.publish({ resource: 'ticket', id: 'OPS-1', projectId: 'broken' });
  assert.equal(feed.subscriberCount('broken'), 0);
});

test('SPEC-platform-13 FR-1: HTTP stream permits a project viewer and rejects cross-project and all-project scopes', async t => {
  const projects = [
    { id: 'one', kind: 'normal', open: false, archivedAt: null },
    { id: 'two', kind: 'normal', open: false, archivedAt: null },
  ];
  const projectStore = {
    async list() { return projects; },
    async get(id) { return projects.find(project => project.id === id) || null; },
    async memberProjectIds(userId) { return userId === 'viewer' ? ['one'] : []; },
    async memberRole() { return 'viewer'; },
  };
  const changeFeed = new ChangeFeed();
  const server = createApiServer({ projectStore, changeFeed, operationsService: { store: { listTickets: async () => [] } } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const requestHeaders = project => ({ 'x-user-id': 'viewer', 'x-user-name': 'Test viewer', 'x-user-roles': 'viewer', 'x-nervecenter-project': project });

  const response = await fetch(`${base}/api/changes/stream`, { headers: requestHeaders('one') });
  assert.equal(response.status, 200);
  const reader = response.body.getReader(); const decoder = new TextDecoder();
  let data = '';
  while (!data.includes('event: ready')) data += decoder.decode((await reader.read()).value, { stream: true });
  changeFeed.publish({ resource: 'ticket', id: 'OPS-1', projectId: 'one' });
  while (!data.includes('event: change')) data += decoder.decode((await reader.read()).value, { stream: true });
  assert.match(data, /event: change\ndata: .*"projectId":"one"/s);
  await reader.cancel();
  const until = Date.now() + 1000;
  while (changeFeed.subscriberCount('one') && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(changeFeed.subscriberCount('one'), 0);

  const crossProject = await fetch(`${base}/api/changes/stream`, { headers: requestHeaders('two') });
  assert.equal(crossProject.status, 403);
  const allProjects = await fetch(`${base}/api/changes/stream`, { headers: requestHeaders('*') });
  assert.equal(allProjects.status, 403);
});

test('SPEC-platform-13 FR-3: manual and imported ticket writes publish only after persistence', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nc-change-feed-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new FileOperationsStore(path.join(dir, 'ops')); await store.init();
  const incident = (system, key) => ({ source: system, sourceKey: `${system}:${key}`, externalReference: { system, sysId: key, number: key }, title: `${system} ${key}`, description: 'source text', priority: 'high', status: 'open', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), metadata: { [system]: { status: 'open' } } });
  const operationsService = new OperationsService({
    store,
    projects: { require: async id => ({ id, kind: 'normal', name: 'Pilot' }) },
    serviceNow: { listIncidents: async () => ({ incidents: [incident('servicenow', 'INC-1')], total: 1 }) },
    jira: { searchIssues: async () => ({ incidents: [incident('jira', 'JIRA-1')], total: 1 }) },
  });
  const feed = new ChangeFeed(); const received = [];
  feed.subscribe('pilot', hint => received.push(hint));
  operationsService.onChangeHint = hint => feed.publish(hint);
  const user = { id: 'test-developer', role: 'admin', name: 'Test developer' };

  const created = await operationsService.createTicket({ scope: pilot, title: 'Manual ticket', creator: user });
  assert.equal(received.at(-1).id, created.ticketId);
  assert.equal(received.at(-1).projectId, 'pilot');
  await operationsService.updateTicket(created.ticketId, { title: 'Edited ticket' }, user, pilot);
  await operationsService.commentTicket(created.ticketId, user, { body: 'A comment', scope: pilot });
  assert.equal(received.length, 3);
  await assert.rejects(operationsService.updateTicket(created.ticketId, { status: 'not-a-status' }, user, pilot));
  await assert.rejects(operationsService.commentTicket(created.ticketId, user, { body: '   ', scope: pilot }));
  assert.equal(received.length, 3);

  await operationsService.syncServiceNow({ scope: pilot });
  const serviceNowTicket = (await store.listTickets(pilot)).find(ticket => ticket.externalReference?.number === 'INC-1');
  assert.ok(serviceNowTicket);
  assert.ok(received.some(hint => hint.id === serviceNowTicket.ticketId && hint.projectId === 'pilot'));
  await operationsService.syncJira({ scope: pilot });
  const jiraTicket = (await store.listTickets(pilot)).find(ticket => ticket.externalReference?.number === 'JIRA-1');
  assert.ok(jiraTicket);
  assert.ok(received.some(hint => hint.id === jiraTicket.ticketId && hint.projectId === 'pilot'));

  const oldProjectHints = []; const newProjectHints = [];
  const feedForMove = new ChangeFeed();
  feedForMove.subscribe('unrouted', hint => oldProjectHints.push(hint));
  feedForMove.subscribe('pilot', hint => newProjectHints.push(hint));
  operationsService.onChangeHint = hint => feedForMove.publish(hint);
  const unrouted = await store.createTicket({ ticketId: 'OPS-ROUTE', projectId: 'unrouted', title: 'Needs routing', status: 'open', priority: 'medium', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), activity: [] });
  await operationsService.routeTicket(unrouted.ticketId, 'pilot', user);
  assert.ok(oldProjectHints.some(hint => hint.id === unrouted.ticketId && hint.projectId === 'unrouted'));
  assert.ok(newProjectHints.some(hint => hint.id === unrouted.ticketId && hint.projectId === 'pilot'));

  const importStore = new FileOperationsStore(path.join(dir, 'import-ops')); await importStore.init();
  const existingImport = { ...incident('servicenow', 'INC-2'), ticketId: 'OPS-UNROUTED', projectId: 'unrouted', connectionId: 'conn', activity: [] };
  await importStore.createTicket(existingImport);
  const importService = new OperationsService({
    store: importStore,
    grants: { route: async () => ({ projectId: 'pilot' }) },
    serviceNow: { listIncidents: async () => ({ incidents: [incident('servicenow', 'INC-2')], total: 1 }) },
  });
  const importFeed = new ChangeFeed(); const unroutedImports = []; const projectImports = [];
  importFeed.subscribe('unrouted', hint => unroutedImports.push(hint));
  importFeed.subscribe('pilot', hint => projectImports.push(hint));
  importService.onChangeHint = hint => importFeed.publish(hint);
  await importService.syncServiceNow({ scope: pilot, connectionId: 'conn' });
  assert.ok(unroutedImports.some(hint => hint.id === 'OPS-UNROUTED' && hint.projectId === 'unrouted'));
  assert.ok(projectImports.some(hint => hint.id === 'OPS-UNROUTED' && hint.projectId === 'pilot'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileOperationsStore } from '../src/app/operations-store.mjs';
import { OperationsService } from '../src/app/operations-service.mjs';
import { buildServiceNowQuery } from '../src/connectors/servicenow/servicenow-service.mjs';
import { tempDir, pilot } from './helpers.mjs';

const tmp = await tempDir('nc-ticket-sync-');

const incident = (number, status, state) => ({ source: 'servicenow', sourceKey: `servicenow:sys-${number}`, externalReference: { system: 'servicenow', sysId: `sys-${number}`, number, url: `https://x/${number}` }, title: `Incident ${number}`, description: '', priority: 'high', status, category: 'Data Platform', tags: [], creator: { id: 'servicenow', name: 'ServiceNow' }, assignee: null, createdAt: '2026-09-24T01:00:00.000Z', updatedAt: '2026-09-24T02:00:00.000Z', metadata: { serviceNow: { number, state } } });
const issue = (key, status, name) => ({ source: 'jira', sourceKey: `jira:${key}`, externalReference: { system: 'jira', sysId: key, number: key, url: `https://x/browse/${key}` }, title: `Issue ${key}`, description: '', priority: 'medium', status, category: 'Task', tags: [], creator: { id: 'jira', name: 'Jira' }, assignee: null, createdAt: '2026-09-24T01:00:00.000Z', updatedAt: '2026-09-24T02:00:00.000Z', metadata: { jira: { key, status: name } } });

test('a ticket that disappears from the active scope is looked up and closed when the source closed it', async () => {
  const store = new FileOperationsStore(path.join(tmp, 'state')); await store.init();
  const calls = [];
  const serviceNow = { async listIncidents(filters) { calls.push(filters); if (filters.numbers) return { incidents: filters.numbers.map(n => incident(n, n === 'INC1' ? 'closed' : 'in_progress', n === 'INC1' ? 'Resolved' : 'In Progress')), total: filters.numbers.length }; return { incidents: [incident('INC2', 'open', 'New')], total: 1 }; } };
  const jira = { async searchIssues(filters) { calls.push(filters); if (filters.keys) return { incidents: filters.keys.map(k => issue(k, 'closed', 'Done')), total: filters.keys.length }; return { incidents: [], total: 0 }; } };
  const service = new OperationsService({ store, serviceNow, jira });
  // first sync: two incidents in scope, one Jira issue
  serviceNow.listIncidents = async filters => { calls.push(filters); return filters.numbers ? { incidents: [incident('INC1', 'closed', 'Resolved')], total: 1 } : { incidents: [incident('INC1', 'open', 'New'), incident('INC2', 'open', 'New')], total: 2 }; };
  const first = await service.syncServiceNow({ scope: pilot }); assert.equal(first.synced, 2); assert.equal(first.closed, 0);
  await store.createTicket({ projectId: 'pilot', ...issue('CDO-7', 'open', 'To Do'), ticketId: await store.nextTicketId(), activity: [] });
  // second sync: INC1 no longer active -> looked up by number -> closed here too, with an activity entry
  serviceNow.listIncidents = async filters => { calls.push(filters); return filters.numbers ? { incidents: [incident('INC1', 'closed', 'Resolved')], total: 1 } : { incidents: [incident('INC2', 'open', 'New')], total: 1 }; };
  const second = await service.syncServiceNow({ scope: pilot });
  assert.equal(second.synced, 1); assert.equal(second.closed, 1);
  assert.deepEqual(calls.at(-1).numbers, ['INC1']);
  const tickets = await store.listTickets(pilot); const inc1 = tickets.find(t => t.externalReference?.number === 'INC1'); const inc2 = tickets.find(t => t.externalReference?.number === 'INC2');
  assert.equal(inc1.status, 'closed'); assert.ok(inc1.closedAt); assert.equal(inc1.metadata.serviceNow.state, 'Resolved'); assert.ok(inc1.activity.some(e => e.type === 'ticket.synced' && e.title === 'Closed in ServiceNow'));
  assert.equal(inc2.status, 'open');
  // Jira: the issue vanished from the not-Done query and is Done when looked up by key
  const jiraSync = await service.syncJira({ scope: pilot }); assert.equal(jiraSync.closed, 1); assert.deepEqual(calls.at(-1).keys, ['CDO-7']);
  assert.equal((await store.listTickets(pilot)).find(t => t.externalReference?.number === 'CDO-7').status, 'closed');
  // a third sync has nothing left to look up
  await service.syncServiceNow({ scope: pilot }); assert.equal(calls.at(-1).numbers, undefined);
});

test('a ticket deleted in the source is cancelled here; a failed lookup changes nothing', async () => {
  const store = new FileOperationsStore(path.join(tmp, 'state-deleted')); await store.init();
  const serviceNow = { listIncidents: async () => ({ incidents: [incident('INC1', 'open', 'New'), incident('INC2', 'in_progress', 'In Progress')], total: 2 }) };
  const jira = { searchIssues: async () => ({ incidents: [], total: 0 }) };
  const service = new OperationsService({ store, serviceNow, jira });
  await service.syncServiceNow({ scope: pilot });
  await store.createTicket({ projectId: 'pilot', ...issue('CDO-9', 'open', 'To Do'), ticketId: await store.nextTicketId(), activity: [] });
  // the lookup itself fails: nothing is cancelled on a guess
  serviceNow.listIncidents = async filters => { if (filters.numbers) throw new Error('timeout'); return { incidents: [], total: 0 }; };
  assert.equal((await service.syncServiceNow({ scope: pilot })).closed, 0);
  assert.ok((await store.listTickets(pilot)).every(t => t.status !== 'cancelled'));
  // INC1 still exists (resolved), INC2 was deleted: the lookup returns only INC1
  serviceNow.listIncidents = async filters => filters.numbers ? { incidents: [incident('INC1', 'resolved', 'Resolved')], total: 1 } : { incidents: [], total: 0 };
  assert.equal((await service.syncServiceNow({ scope: pilot })).closed, 2);
  const tickets = await store.listTickets(pilot); const inc1 = tickets.find(t => t.externalReference?.number === 'INC1'); const inc2 = tickets.find(t => t.externalReference?.number === 'INC2');
  assert.equal(inc1.status, 'resolved');
  assert.equal(inc2.status, 'cancelled'); assert.ok(inc2.closedAt); assert.ok(inc2.activity.some(e => e.type === 'ticket.synced' && e.title === 'Deleted in ServiceNow'));
  // Jira works the same way
  assert.equal((await service.syncJira({ scope: pilot })).closed, 1);
  assert.equal((await store.listTickets(pilot)).find(t => t.externalReference?.number === 'CDO-9').status, 'cancelled');
});

test('looking incidents up by number drops the active filter', () => {
  assert.equal(buildServiceNowQuery('active=true^ORDERBYDESCsys_updated_on', { numbers: ['INC1', 'INC2'], assignmentGroup: 'Data Platform Support' }), 'numberININC1,INC2^assignment_group.name=Data Platform Support^ORDERBYDESCsys_updated_on');
  assert.equal(buildServiceNowQuery('active=true^ORDERBYDESCsys_updated_on', { assignmentGroup: 'Data Platform Support' }), 'active=true^assignment_group.name=Data Platform Support^ORDERBYDESCsys_updated_on');
});

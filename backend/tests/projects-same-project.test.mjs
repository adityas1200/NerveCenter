import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { FileOperationsStore } from '../src/app/operations-store.mjs';
import { FileTaskStore } from '../src/tasks/task-store.mjs';
import { OperationsService } from '../src/app/operations-service.mjs';
import { createAppTools } from '../src/tasks/nervecenter-tools.mjs';
import { systemScope } from '../src/projects/project-access.mjs';
import { fakeMcpSdk, tempDir } from './helpers.mjs';

// SPEC-projects-01 FR-48, FR-49 and FR-40: similarity, recurrence and links stay inside one project, and the
// agent's tools read through the operations service with the task's project.
const tmp = await tempDir('nc-same-project-');
const asha = { id: 'asha.rao', name: 'Asha Rao' };
const rbacStore = { overlay: user => ({ ...user, storedRole: 'developer' }) };
const alpha = systemScope('alpha'); const beta = systemScope('beta');
const DAY = 86_400_000;
const daysAgo = days => new Date(Date.now() - days * DAY).toISOString();

let counter = 0;
async function setup() {
  const store = new FileOperationsStore(path.join(tmp, `ops-${counter += 1}`)); await store.init();
  const taskStore = new FileTaskStore(path.join(tmp, `tasks-${counter}`)); await taskStore.init();
  const service = new OperationsService({ store });
  const tools = (projectId, acting = asha) => createAppTools({ operationsService: service, taskStore, rbacStore, agentName: 'Dobby' })({ id: 'T-9', projectId, createdBy: acting }, fakeMcpSdk);
  const make = (scope, title, description = '') => service.createTicket({ scope, title, description, creator: asha, visibility: 'operators' });
  const resolve = (ticketId, ago = 1) => store.updateTicket(ticketId, { status: 'resolved', resolutionSummary: 'Fixed.', closedAt: daysAgo(ago) }, { touch: false });
  return { store, service, tools, make, resolve };
}

test('FR-48: find_similar_tickets never returns a ticket from another project, even with the same signature', async () => {
  const { service, tools, make, resolve } = await setup();
  const current = await make(alpha, 'Orders load failed', 'Table not found: gold.orders_daily');
  const elsewhere = await make(beta, 'Orders load failed', 'Table not found: gold.orders_daily');
  const here = await make(alpha, 'Orders load failed', 'Table not found: gold.orders_daily 2026-09-30');
  await resolve(elsewhere.ticketId); await resolve(here.ticketId, 5);
  const viaService = await service.findSimilarTickets({ ticketId: current.ticketId, user: asha, scope: alpha });
  assert.deepEqual(viaService.hits.map(hit => hit.ticket.ticketId), [here.ticketId]);
  const viaTool = await tools('alpha').call('find_similar_tickets', { ticketId: current.ticketId });
  assert.deepEqual(viaTool.tickets.map(item => item.ticketId), [here.ticketId]);
  const text = await tools('beta').call('find_similar_tickets', { text: 'orders load failed' });
  assert.deepEqual(text.tickets.map(item => item.ticketId), [elsewhere.ticketId], 'free text searches only the task\'s project');
});

test('FR-48: a recurrence is detected only against earlier tickets of the same project', async () => {
  const { store, make, resolve } = await setup();
  const earlier = await make(alpha, 'Load failed for hcp', 'Timeout reading hcp feed'); await resolve(earlier.ticketId, 2);
  const otherProject = await make(beta, 'Load failed for hcp', 'Timeout reading hcp feed');
  assert.equal((await store.getTicket(otherProject.ticketId)).links?.length || 0, 0, 'beta does not recur alpha\'s fix');
  assert.equal((await store.getTicket(earlier.ticketId)).links?.length || 0, 0);
  const sameProject = await make(alpha, 'Load failed for hcp', 'Timeout reading hcp feed');
  assert.deepEqual((await store.getTicket(sameProject.ticketId)).links.map(link => [link.relation, link.ticketId]), [['recurrence_of', earlier.ticketId]]);
});

test('FR-48: link_related_ticket and linkTickets refuse a ticket from another project and say nothing about it', async () => {
  const { service, store, tools, make } = await setup();
  const mine = await make(alpha, 'Mine'); const theirs = await make(beta, 'Theirs, a secret title');
  await assert.rejects(service.linkTickets(mine.ticketId, theirs.ticketId, { relation: 'related_to', user: asha, scope: alpha }), error => error.statusCode === 403 && !/secret/.test(error.message));
  const result = await tools('alpha').tools.find(item => item.name === 'link_related_ticket').handler({ ticketId: mine.ticketId, relatedTicketId: theirs.ticketId, relation: 'related_to' });
  assert.equal(result.isError, true); assert.ok(!JSON.stringify(result).includes('secret'));
  assert.equal((await store.getTicket(mine.ticketId)).links?.length || 0, 0);
  assert.equal((await store.getTicket(theirs.ticketId)).links?.length || 0, 0);
  const sibling = await make(alpha, 'Sibling');
  assert.equal((await service.linkTickets(mine.ticketId, sibling.ticketId, { relation: 'related_to', user: asha, scope: alpha })).linked, true);
});

test('FR-49: a ticket that points at one the caller cannot open keeps the timeline event but loses the id and title', async () => {
  const { service, store, make } = await setup();
  const mine = await make(alpha, 'Mine'); const theirs = await make(beta, 'Theirs, a secret title');
  // A legacy cross-project link (written before projects existed) must not leak through get_ticket.
  await store.updateTicket(mine.ticketId, { links: [{ relation: 'related_to', direction: 'out', ticketId: theirs.ticketId, at: new Date().toISOString() }] });
  await store.appendActivity(mine.ticketId, [{ id: 'e1', type: 'ticket.link', status: 'completed', title: `Related to ${theirs.ticketId}`, detail: 'Theirs, a secret title', at: new Date().toISOString(), relatedTicketId: theirs.ticketId }]);
  const view = await service.ticket(mine.ticketId, asha, alpha);
  assert.equal(view.links.length, 0);
  const text = JSON.stringify(view);
  assert.ok(!text.includes(theirs.ticketId) && !text.includes('secret'), 'neither the id nor the title is in the view');
  assert.ok(view.activity.some(event => event.type === 'ticket.link' && event.title === 'Linked to a ticket you cannot access'), 'the event keeps its place');
});

test('FR-40: an agent tool given a ticket from another project reports it as not in this project', async () => {
  const { tools, make } = await setup();
  const mine = await make(alpha, 'Mine'); const theirs = await make(beta, 'Theirs, a secret title');
  const server = tools('alpha');
  assert.equal((await server.call('get_ticket', { ticketId: mine.ticketId })).ticketId, mine.ticketId);
  const denied = await server.tools.find(item => item.name === 'get_ticket').handler({ ticketId: theirs.ticketId });
  assert.equal(denied.isError, true); assert.match(denied.content[0].text, /No ticket .* in this project/); assert.ok(!denied.content[0].text.includes('secret'));
  const missing = await server.tools.find(item => item.name === 'get_ticket').handler({ ticketId: 'OPS-99999' });
  assert.equal(missing.content[0].text.replace(/OPS-99999/, 'X'), denied.content[0].text.replace(theirs.ticketId, 'X'), 'a missing id reads the same');
  const listed = await server.call('list_tickets', {});
  assert.ok((listed.tickets || listed.items || []).every(ticket => ticket.ticketId !== theirs.ticketId));
  const task = tools('alpha'); assert.ok(task);
  assert.throws(() => createAppTools({ operationsService: {}, taskStore: {}, rbacStore })({ id: 'T-0', createdBy: asha }, fakeMcpSdk), /no project/, 'a task without a project gets no tools');
});

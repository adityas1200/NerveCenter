import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { z } from 'zod';
import { FileOperationsStore } from '../src/app/operations-store.mjs';
import { FileTaskStore } from '../src/tasks/task-store.mjs';
import { OperationsService } from '../src/app/operations-service.mjs';
import { createAppTools } from '../src/tasks/nervecenter-tools.mjs';
import { failureSignature, normalizeText } from '../src/app/ticket-signature.mjs';
import { bm25Ranker } from '../src/app/ticket-similarity.mjs';
import { validateOperations } from '../src/workspace/workspace.mjs';
import { fakeMcpSdk, tempDir, pilot } from './helpers.mjs';

const tmp = await tempDir('nc-ticket-similar-');
const asha = { id: 'asha.rao', name: 'Asha Rao' };
const ravi = { id: 'ravi.k', name: 'Ravi K' };
// Development identity makes everyone an admin; these people are plain developers, so ticket access is real.
const rbacStore = { overlay: user => ({ ...user, storedRole: 'developer' }) };
const DAY = 86_400_000;
const daysAgo = days => new Date(Date.now() - days * DAY).toISOString();

let counter = 0;
async function setup({ windowDays } = {}) {
  const store = new FileOperationsStore(path.join(tmp, `ops-${counter += 1}`)); await store.init();
  const taskStore = new FileTaskStore(path.join(tmp, `tasks-${counter}`)); await taskStore.init();
  const comments = [];
  const service = new OperationsService({ store, serviceNow: { updateIncident: async ({ sysId, fields }) => { comments.push({ sysId, fields }); return null; } } });
  if (windowDays !== undefined) service.workspace = { readOperations: async () => ({ tickets: { recurrenceWindowDays: windowDays } }) };
  const server = (acting = asha) => createAppTools({ operationsService: service, taskStore, rbacStore, agentName: 'Dobby' })({ id: 'T-9', projectId: 'pilot', createdBy: acting }, fakeMcpSdk);
  // Closes a ticket the way the app does, at a chosen time.
  const resolve = (ticketId, { resolution = 'Fixed.', ago = 1 } = {}) => store.updateTicket(ticketId, { status: 'resolved', resolutionSummary: resolution, closedAt: daysAgo(ago) }, { touch: false });
  return { store, taskStore, service, server, comments, resolve };
}
const manual = (service, title, description = '', extra = {}) => service.createTicket({ scope: pilot, title, description, creator: asha, visibility: 'operators', ...extra });

test('the same failure with different run ids, timestamps, paths and hashes has one signature', () => {
  const failure = (run, when, dir, hex, uuid) => ({ pipelineId: '731', platform: 'databricks', failingTask: 'load_hcp', failureSummary: `Run ${run} failed at ${when}: org.apache.spark.sql.AnalysisException: Table or view not found: gold.dim_hcp in ${dir} (0x${hex}, request ${uuid})` });
  const a = failureSignature(failure(8841, '2026-10-03T04:11:09Z', '/mnt/raw/2026/10/03/part-0001.parquet', '7f3a9c12', '7b2f1c3e-aaaa-4bbb-8ccc-1234567890ab'));
  const b = failureSignature(failure(9120, '2026-10-04 05:00:00.123', '/mnt/raw/2026/10/04/part-0099.parquet', 'deadbeef', '11111111-2222-4333-8444-555555555555'));
  assert.match(a, /^pipe:[0-9a-f]{16}$/); assert.equal(a, b);
  assert.notEqual(a, failureSignature({ ...failure(1, '', '', '', ''), failureSummary: 'java.lang.OutOfMemoryError: Java heap space' }), 'another error is another signature');
  assert.notEqual(a, failureSignature({ ...failure(1, '', '', '', ''), pipelineId: '732' }), 'another pipeline is another signature');
  assert.notEqual(a, failureSignature({ ...failure(1, '', '', '', ''), failingTask: 'load_npi' }), 'another task is another signature');
  assert.equal(normalizeText('Run 42 at 10:15:03 wrote /a/b/c to s3://bucket/key 0xFF'), 'run at wrote to');
});

test('other tickets sign on a fingerprint of title and description; pull requests are not signed', () => {
  const a = failureSignature({ title: 'Access request for the Veltrix share', description: 'Please grant access, ticket 4412' });
  assert.match(a, /^text:/);
  assert.equal(a, failureSignature({ title: 'access request for the VELTRIX share!', description: 'Please grant access, ticket 9981' }));
  assert.notEqual(a, failureSignature({ title: 'Access request for the Orion share', description: 'Please grant access' }));
  assert.equal(failureSignature({ title: 'x' }), null); assert.equal(failureSignature({ type: 'pull_request', title: 'Fix the loader' }), null);
});

test('new tickets are signed, and editing the description re-signs them', async () => {
  const { service, store } = await setup();
  const created = await manual(service, 'Territory report shows duplicate HCPs', 'Rows repeat after the 6am load');
  assert.match(created.signature, /^text:/);
  await service.updateTicket(created.ticketId, { description: 'Completely different: the NPI feed is empty' }, asha, pilot);
  assert.notEqual((await store.getTicket(created.ticketId)).signature, created.signature);
});

test('signatures are filled in for old tickets without touching their updated time', async () => {
  const { service, store } = await setup();
  const base = { status: 'open', priority: 'high', activity: [], createdAt: daysAgo(40), updatedAt: daysAgo(40), visibility: 'operators' };
  await store.createTicket({ projectId: 'pilot', ...base, ticketId: 'OPS-1', title: 'Nightly load failed for orders', description: 'Timeout reading orders' });
  await store.createTicket({ projectId: 'pilot', ...base, ticketId: 'OPS-2', title: 'x' });
  assert.equal(await service.backfillSignatures(), 2);
  const [one, two] = [await store.getTicket('OPS-1'), await store.getTicket('OPS-2')];
  assert.match(one.signature, /^text:/); assert.equal(two.signature, null); assert.equal(one.updatedAt, base.updatedAt);
  assert.equal(await service.backfillSignatures(), 0);
  assert.deepEqual((await store.findTicketsBySignature(one.signature, pilot)).map(ticket => ticket.ticketId), ['OPS-1']);
});

test('find_similar_tickets: same signature beats similar text, and a ranker can be swapped in', async () => {
  const { service, resolve, server } = await setup();
  const current = await manual(service, 'Orders load failed', 'Table not found: gold.orders_daily');
  // Lots of shared words but another signature, resolved more recently.
  const wordy = await manual(service, 'Orders load failed, table gold.orders_daily not found, load orders daily table', 'orders orders load failed daily table not found');
  const sameSignature = await manual(service, 'Orders load failed', 'Table not found: gold.orders_daily 2026-09-30'); // numbers and dates do not change the signature
  const unrelated = await manual(service, 'Printer queue stuck on floor 3', 'Nothing to do with data');
  await resolve(wordy.ticketId, { resolution: 'Recreated the table.', ago: 1 }); await resolve(sameSignature.ticketId, { resolution: 'Restored the view.', ago: 10 }); await resolve(unrelated.ticketId);
  assert.equal(current.signature, sameSignature.signature);

  const result = await server().call('find_similar_tickets', { ticketId: current.ticketId });
  assert.deepEqual(result.tickets.map(item => item.ticketId), [sameSignature.ticketId, wordy.ticketId]);
  assert.equal(result.tickets[0].matchReason, 'same signature'); assert.equal(result.tickets[1].matchReason, 'similar text');
  assert.ok(result.tickets[1].score > 0); assert.equal(result.tickets[0].resolutionSummary, 'Restored the view.'); assert.ok(result.tickets[0].resolvedAt);
  assert.ok(!result.tickets.some(item => item.ticketId === unrelated.ticketId || item.ticketId === current.ticketId));

  // Free text works without a ticket; limit and status apply.
  const text = await server().call('find_similar_tickets', { text: 'printer queue stuck', limit: 1 });
  assert.deepEqual(text.tickets.map(item => item.ticketId), [unrelated.ticketId]);
  assert.equal((await server().call('find_similar_tickets', { text: 'printer queue stuck', status: ['open'] })).total, 0);

  // The seam: any object with rank() replaces the word search.
  service.similarityRanker = { name: 'fake-embeddings', rank: async ({ documents }) => documents.filter(doc => doc.id === unrelated.ticketId).map(doc => ({ id: doc.id, score: 0.9 })) };
  const swapped = await server().call('find_similar_tickets', { text: 'anything at all' });
  assert.equal(swapped.ranker, 'fake-embeddings'); assert.deepEqual(swapped.tickets.map(item => item.ticketId), [unrelated.ticketId]);
});

test('BM25 ranks the closest wording first and ignores one shared common word', async () => {
  const hits = await bm25Ranker.rank({ query: 'snowflake warehouse suspended during nightly load', documents: [
    { id: 'a', text: 'Snowflake warehouse suspended during the nightly load' }, { id: 'b', text: 'Nightly load slow' }, { id: 'c', text: 'Birthday party planning' },
  ] });
  assert.equal(hits[0].id, 'a'); assert.ok(!hits.some(hit => hit.id === 'c'));
  assert.deepEqual(await bm25Ranker.rank({ query: 'the and of', documents: [{ id: 'a', text: 'the and of' }] }), []);
});

test('find_similar_tickets only returns tickets the acting user can open', async () => {
  const { service, resolve, server } = await setup();
  const mine = await manual(service, 'Quarterly rebate load failed', 'rebate load failed in the quarterly job');
  const hidden = await manual(service, 'Quarterly rebate load failed', 'rebate load failed in the quarterly job', { visibility: 'private' });
  const shared = await manual(service, 'Quarterly rebate job failed on load', 'rebate load failed quarterly', { creator: ravi });
  await resolve(hidden.ticketId); await resolve(shared.ticketId);
  const asRavi = await server(ravi).call('find_similar_tickets', { text: 'quarterly rebate load failed' });
  assert.deepEqual(asRavi.tickets.map(item => item.ticketId), [shared.ticketId], 'the private ticket of another person stays hidden');
  const asAsha = await server(asha).call('find_similar_tickets', { text: 'quarterly rebate load failed' });
  assert.ok(asAsha.tickets.some(item => item.ticketId === hidden.ticketId));
  // Searching from a ticket the person cannot open is refused, as for get_ticket.
  const refused = await server(ravi).tools.find(item => item.name === 'find_similar_tickets').handler({ ticketId: hidden.ticketId });
  assert.equal(refused.isError, true); assert.match(refused.content[0].text, /do not have access/);
  assert.equal(mine.visibility, 'project');
});

test('hits carry who resolved the ticket and the findings its agent task recorded', async () => {
  const { service, store, taskStore, server } = await setup();
  const old = await manual(service, 'Veltrix feed arrives empty', 'The Veltrix feed file is empty each Monday');
  await store.updateTicket(old.ticketId, { taskId: 'T-5' });
  await service.updateTicket(old.ticketId, { status: 'resolved', resolutionSummary: 'Vendor changed the delimiter.' }, asha, pilot);
  for (const input of [{ kind: 'hypothesis', text: 'File missing' }, { kind: 'root_cause', text: 'Delimiter changed to pipe' }, { kind: 'fix', text: 'Set delimiter option on the reader' }, { kind: 'verification', text: 'Reran, 12k rows' }]) await taskStore.appendEvent('T-5', { type: 'tool.use', name: 'mcp__nervecenter__record_finding', input });
  await taskStore.appendEvent('T-5', { type: 'tool.use', name: 'mcp__nervecenter__record_finding', input: { kind: 'fix', text: 'sub-agent noise' }, parentToolUseId: 'x' });
  const [hit] = (await server().call('find_similar_tickets', { text: 'veltrix feed empty' })).tickets;
  assert.equal(hit.ticketId, old.ticketId); assert.equal(hit.resolvedBy, 'Asha Rao'); assert.equal(hit.taskId, 'T-5');
  assert.deepEqual(hit.findings.map(finding => finding.kind), ['root_cause', 'fix', 'verification']);
});

test('link_related_ticket links both tickets, logs both, comments on the other, and needs a reason', async () => {
  const { service, store, server, comments } = await setup();
  const now = new Date().toISOString();
  await store.createTicket({ projectId: 'pilot', ticketId: 'OPS-1', title: 'Old failure', status: 'resolved', priority: 'high', activity: [], createdAt: now, updatedAt: now, visibility: 'operators', source: 'servicenow', sourceKey: 'servicenow:1', externalReference: { system: 'servicenow', sysId: '1', number: 'INC1' } });
  const fresh = await manual(service, 'New failure');
  const tool = server().tools.find(item => item.name === 'link_related_ticket');
  assert.equal(z.object(tool.shape).safeParse({ ticketId: fresh.ticketId, relatedTicketId: 'OPS-1', relation: 'amends_fix_of' }).success, false, 'reason is required');
  assert.equal(z.object(tool.shape).safeParse({ ticketId: fresh.ticketId, relatedTicketId: 'OPS-1', relation: 'amends_fix_of', reason: 'Fix v1 was incomplete' }).success, true);
  assert.equal(z.object(tool.shape).safeParse({ ticketId: fresh.ticketId, relatedTicketId: 'OPS-1', relation: 'fixes', reason: 'Fix v1 was incomplete' }).success, false);

  const result = await server().call('link_related_ticket', { ticketId: fresh.ticketId, relatedTicketId: 'INC1', relation: 'amends_fix_of', comment: 'Fix v1 missed the NPI feed; amended in the new ticket.', reason: 'Fix v1 was incomplete' });
  assert.equal(result.linked, true); assert.equal(result.commented, true);
  const [a, b] = [await store.getTicket(fresh.ticketId), await store.getTicket('OPS-1')];
  assert.deepEqual(a.links.map(({ relation, direction, ticketId }) => ({ relation, direction, ticketId })), [{ relation: 'amends_fix_of', direction: 'out', ticketId: 'OPS-1' }]);
  assert.deepEqual(b.links.map(({ relation, direction, ticketId }) => ({ relation, direction, ticketId })), [{ relation: 'amends_fix_of', direction: 'in', ticketId: fresh.ticketId }]);
  assert.ok(a.activity.some(event => event.type === 'ticket.link' && /Amends the fix of OPS-1/.test(event.title)));
  assert.ok(b.activity.some(event => event.type === 'ticket.link' && event.title === `Fix amended in ${fresh.ticketId}`));
  assert.ok(b.activity.some(event => event.type === 'ticket.comment' && /missed the NPI feed/.test(event.detail)));
  assert.match(comments[0].fields.work_notes, /missed the NPI feed[\s\S]*Dobby for Asha Rao via NerveCenter/, 'the comment reaches ServiceNow');
  assert.equal((await service.ticket(fresh.ticketId, asha, pilot)).links.length, 1);

  assert.equal((await server().call('link_related_ticket', { ticketId: fresh.ticketId, relatedTicketId: 'OPS-1', relation: 'amends_fix_of', reason: 'again' })).linked, false, 'linking twice changes nothing');
  assert.equal((await store.getTicket('OPS-1')).links.length, 1);
  await assert.rejects(service.linkTickets(fresh.ticketId, fresh.ticketId, { relation: 'related_to', user: asha, scope: pilot }), /itself/);
  await assert.rejects(service.linkTickets(fresh.ticketId, 'OPS-1', { relation: 'blocks', user: asha, scope: pilot }), /relation must be one of/);
});

test('a ticket with the signature of one resolved inside the window is a recurrence', async () => {
  const { service, store, resolve, server } = await setup();
  const first = await manual(service, 'Territory report shows duplicate HCPs', 'Rows repeat after the 6am load');
  await resolve(first.ticketId, { resolution: 'Added a dedupe step.', ago: 5 });
  const again = await manual(service, 'Territory report shows duplicate HCPs', 'Rows repeat after the 6am load');

  const [a, b] = [await store.getTicket(again.ticketId), await store.getTicket(first.ticketId)];
  assert.deepEqual(a.links.map(({ relation, direction, ticketId, auto }) => ({ relation, direction, ticketId, auto })), [{ relation: 'recurrence_of', direction: 'out', ticketId: first.ticketId, auto: true }]);
  assert.equal(b.links[0].direction, 'in');
  const onNew = a.activity.find(event => event.type === 'ticket.recurrence'); const onOld = b.activity.find(event => event.type === 'ticket.recurrence');
  assert.equal(onNew.title, `Fix for ${first.ticketId} didn't hold`); assert.match(onNew.detail, /Added a dedupe step/); assert.ok(onOld);

  const view = await service.ticket(again.ticketId, asha, pilot);
  assert.equal(view.recurrence.ofTicketId, first.ticketId); assert.equal(view.recurrence.auto, true);
  const seen = await server().call('get_ticket', { ticketId: again.ticketId });
  assert.equal(seen.recurrence.ofTicketId, first.ticketId); assert.equal(seen.recurrence.ofResolutionSummary, 'Added a dedupe step.'); assert.equal(seen.links[0].relation, 'recurrence_of');

  const feed = await service.notifications(asha, { scope: pilot });
  const item = feed.items.find(entry => entry.kind === 'ticket.recurrence');
  assert.equal(item.title, `Fix for ${first.ticketId} didn't hold`); assert.equal(item.tone, 'warning'); assert.equal(item.ticketId, again.ticketId);
  assert.equal(feed.items.filter(entry => entry.kind === 'ticket.recurrence').length, 1, 'one notification, not one per ticket');
});

test('no recurrence when the earlier fix is outside the window, still open, or the window is 0', async () => {
  for (const [windowDays, ago, closed] of [[undefined, 31, true], [7, 10, true], [30, 1, false], [0, 1, true]]) {
    const { service, store, resolve } = await setup({ windowDays });
    const first = await manual(service, 'Rebate accrual job failed', 'Accrual job failed on the Monday run');
    if (closed) await resolve(first.ticketId, { ago });
    const again = await manual(service, 'Rebate accrual job failed', 'Accrual job failed on the Monday run');
    assert.equal((await store.getTicket(again.ticketId)).links, undefined, `window ${windowDays}, closed ${ago} days ago, closed=${closed}`);
    assert.equal((await service.ticket(again.ticketId, asha, pilot)).recurrence, null);
  }
  const { service, resolve } = await setup({ windowDays: 7 });
  const first = await manual(service, 'Rebate accrual job failed', 'Accrual job failed on the Monday run'); await resolve(first.ticketId, { ago: 6 });
  assert.ok((await service.ticket((await manual(service, 'Rebate accrual job failed', 'Accrual job failed on the Monday run')).ticketId, asha, pilot)).recurrence, 'a configured window of 7 days catches a fix from 6 days ago');
});

test('a pipeline failure after a fix is flagged even though the run id and timestamp differ', async () => {
  const { service, store, resolve } = await setup();
  let run = 0;
  service._getPlatformRun = async ({ runId }) => ({ status: 'failed', platform: 'databricks', failingTask: 'load_hcp', startTime: now(), failureSummary: `Run ${runId} failed at ${new Date().toISOString()}: AnalysisException: Table not found: gold.dim_hcp in /mnt/raw/${runId}/part.parquet` });
  service._getPlatformPipeline = async () => ({ name: 'HCP load' });
  const now = () => new Date().toISOString();
  const first = await service.createTicket({ scope: pilot, pipelineId: '731', runId: String(8000 + (run += 1)), platform: 'databricks', creator: asha, assignee: null });
  assert.equal(first.failingTask, 'load_hcp');
  await resolve(first.ticketId, { resolution: 'Recreated the table.', ago: 2 });
  const second = await service.createTicket({ scope: pilot, pipelineId: '731', runId: String(8000 + (run += 1)), platform: 'databricks', creator: asha, assignee: null });
  assert.equal(second.signature, first.signature);
  assert.equal((await store.getTicket(second.ticketId)).links[0].ticketId, first.ticketId);
  // Creating the same run again changes nothing: not a new ticket.
  assert.equal((await service.createTicket({ scope: pilot, pipelineId: '731', runId: '8002', platform: 'databricks', creator: asha, assignee: null })).ticketId, second.ticketId);
  assert.equal((await store.getTicket(second.ticketId)).links.length, 1);
});

test('an imported ticket that matches a recent fix is flagged, a known one is not flagged again', async () => {
  const { service, store, resolve } = await setup();
  const first = await manual(service, 'Veltrix load failed', 'The Veltrix load failed with a timeout'); await resolve(first.ticketId, { ago: 3 });
  const incident = number => ({ source: 'servicenow', sourceKey: `servicenow:sys-${number}`, externalReference: { system: 'servicenow', sysId: `sys-${number}`, number }, title: 'Veltrix load failed', description: 'The Veltrix load failed with a timeout', status: 'open', priority: 'high', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  service.serviceNow = { listIncidents: async () => ({ incidents: [incident('INC7')], total: 1 }) };
  await service.syncServiceNow({ scope: pilot }); await service.syncServiceNow({ scope: pilot });
  const imported = (await store.listTickets(pilot)).find(ticket => ticket.externalReference?.number === 'INC7');
  assert.equal(imported.links.length, 1); assert.equal(imported.links[0].ticketId, first.ticketId);
  assert.equal(imported.activity.filter(event => event.type === 'ticket.recurrence').length, 1);
});

test('tickets.recurrenceWindowDays is a known section and must be a whole number of days', () => {
  const base = { team: { name: 'Ops', timezone: 'UTC' } };
  assert.deepEqual(validateOperations({ ...base, tickets: { recurrenceWindowDays: 14 } }).errors, []);
  assert.ok(!validateOperations({ ...base, tickets: { recurrenceWindowDays: 14 } }).warnings.some(warning => /unrecognized/.test(warning)));
  assert.match(validateOperations({ ...base, tickets: { recurrenceWindowDays: -1 } }).errors[0], /recurrenceWindowDays/);
  assert.match(validateOperations({ ...base, tickets: { recurrenceWindowDays: 'soon' } }).errors[0], /recurrenceWindowDays/);
});

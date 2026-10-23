import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { tempDir } from './helpers.mjs';
import { FileOperationsStore } from '../src/app/operations-store.mjs';
import { OperationsService } from '../src/app/operations-service.mjs';
import { overviewTickets, overviewWork } from '../src/app/overview-summary.mjs';
import { systemScope } from '../src/projects/project-access.mjs';
import { config } from '../src/config.mjs';

// ADR 0021: store-side Overview counts must equal what the load-everything path returned (SPEC-overview-01 FR-3, FR-4, FR-8).
const projectId = 'ov';
const day = 86_400_000;
const from = '2026-10-01T00:00:00.000Z', to = '2026-10-08T00:00:00.000Z';
const at = (days, hours = 0) => new Date(Date.parse(from) + days * day + hours * 3_600_000).toISOString();
const windowed = { from, to, buckets: Array.from({ length: 7 }, (_, i) => [Date.parse(from) + i * day, Date.parse(from) + (i + 1) * day]) };
const unwindowed = { from: null, to: null, buckets: windowed.buckets };

const people = {
  nobody: undefined,
  admin: { id: 'admin-1', role: 'admin', groups: [], roles: [] },
  alice: { id: 'alice', email: 'alice@example.test', groups: ['dq-team'], roles: [] },
  owner: { id: 'olivia', groups: [], roles: [], projectOwnerIds: [projectId] },
  visitor: { id: 'vic', groups: [], roles: [] },
};

function fixture() {
  const base = (id, extra) => ({ ticketId: id, projectId, title: `Ticket ${id}`, status: 'open', priority: 'medium', visibility: 'project', createdAt: at(1), updatedAt: at(1), ...extra });
  return [
    base('OV-1', { priority: 'critical', createdAt: at(0, 3) }),
    base('OV-2', { priority: 'high', visibility: 'private', creator: { id: 'alice' } }),
    base('OV-3', { visibility: 'private', creator: { id: 'bob' } }),
    base('OV-4', { status: 'closed', visibility: 'private', collaborators: [{ id: 'alice' }], closedAt: at(2), taskId: 'task-4', taskChanges: 2, category: 'data_quality' }),
    base('OV-5', { status: 'canceled', updatedAt: at(3) }),
    base('OV-6', { status: 'resolved', pipelineId: 'job-1', taskId: 'task-6', taskChanges: '1', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z', closedAt: '2026-09-02T00:00:00.000Z' }),
    base('OV-7', { status: 'archived', priority: 'low', tags: ['DQ', 'nightly'], taskId: 'task-7', taskChanges: 1, closedAt: at(4) }),
    base('OV-8', { source: 'monitor' }),
    base('OV-9', { visibility: 'private', metadata: { source: 'data-quality' }, approver: { id: 'dq-team' } }),
    base('OV-10', { priority: 'P1' }),
    base('OV-11', { priority: undefined, createdAt: 'not a date' }),
    base('OV-12', { status: 'Closed', closedAt: '', updatedAt: at(5) }),
    base('OV-13', { visibility: 'private', assignee: 'alice' }),
    base('OV-14', { visibility: 'operators', context: { businessCheckId: 'chk-1' } }),
    base('OV-15', { status: 'closed', taskId: 'task-15', taskChanges: 0, closedAt: at(6) }),
    base('OV-16', { createdAt: at(3), title: 'Nightly load failed' }),
    base('OV-17', { createdAt: '2026-10-02', title: 'Date-only created', taskChanges: 'lots' }),
  ];
}

// The pre-ADR 0021 overviewTickets, verbatim apart from reading tickets through listTickets: the reference the store must match.
const chartCounts = (rows, buckets, at) => buckets.map(([start, end]) => rows.filter(row => { const ms = Date.parse(at(row)); return ms >= start && ms < end; }).length);
const closed = row => ['closed', 'cancelled', 'canceled', 'resolved', 'archived'].includes(String(row.status).toLowerCase());
async function before(service, user, scope, query) {
  const data = await service.overview(user, { ...query, scope });
  const tickets = await service.listTickets({ status: 'all', user, scope });
  const dq = tickets.filter(t => !closed(t) && (t.kind === 'data_quality' || String(t.category || '').toLowerCase() === 'data_quality' || ['agentic-monitor', 'data-quality', 'dq', 'monitor'].includes(String(t.source || t.metadata?.source || '').toLowerCase()) || t.context?.businessCheckId));
  const { items: _items, ...agentResolved } = data.agentResolved;
  return { ticketSummary: data.ticketSummary, agentResolved, dqOpen: dq.length,
    chart: { raised: chartCounts(tickets, query.buckets, t => t.createdAt), resolved: chartCounts(tickets.filter(closed), query.buckets, t => t.closedAt || t.updatedAt), dqResolved: chartCounts(tickets.filter(t => t.resolvedWithAgent && t.kind === 'data_quality'), query.buckets, t => t.closedAt || t.updatedAt) } };
}
const counts = ({ generatedAt: _generatedAt, ...rest }) => rest;

async function fileService() {
  const dir = await tempDir('nc-overview-counts-');
  const store = new FileOperationsStore(path.join(dir, 'application-state.json')); await store.init();
  for (const ticket of fixture()) await store.createTicket(ticket);
  return new OperationsService({ store });
}

test('ADR 0021: file-store Overview counts equal the load-everything path for every reader and window', async () => {
  const service = await fileService(); const scope = systemScope(projectId);
  for (const [who, user] of Object.entries(people)) for (const [label, query] of Object.entries({ windowed, unwindowed })) {
    assert.deepEqual(counts(await overviewTickets(service, user, scope, query)), await before(service, user, scope, query), `${who}, ${label}`);
  }
});

test('ADR 0021 / SPEC-projects-02 FR-20..FR-23: counts leave out private tickets the reader may not see', async () => {
  const service = await fileService(); const scope = systemScope(projectId);
  const total = fixture().length;
  const open = async user => (await service.ticketOverview(user, { scope, ...unwindowed })).ticketSummary;
  const admin = await open(people.admin), visitor = await open(people.visitor), alice = await open(people.alice);
  assert.equal(admin.open + admin.closed, total);
  // OV-2, 3, 4, 9 and 13 are private; the visitor is on none of them.
  assert.equal(visitor.open + visitor.closed, total - 5);
  // Alice created OV-2, collaborates on OV-4, approves OV-9 through her group and is assigned OV-13; OV-3 stays hidden.
  assert.equal(alice.open + alice.closed, total - 1);
  assert.deepEqual(await open(people.owner), admin);
});

test('ADR 0021: chart buckets are half-open and keep the canceled spelling the summary ignores', async () => {
  const service = await fileService(); const scope = systemScope(projectId);
  const result = await service.ticketOverview(people.admin, { scope, ...windowed });
  // OV-1 on day 0; twelve on day 1 plus date-only OV-17 (UTC midnight); OV-16 starts exactly at day 3 and belongs to that bucket.
  // OV-6 is before the window, OV-11 has no date.
  assert.deepEqual(result.chart.raised, [1, 13, 0, 1, 0, 0, 0]);
  // OV-5 is canceled: closed for the chart, still open for the summary.
  assert.equal(result.chart.resolved[3], 1);
  // Closed: OV-4, OV-6, OV-7, OV-12 ("Closed") and OV-15.
  assert.equal(result.ticketSummary.open, 12);
  // P1 and a missing priority both count as other.
  assert.deepEqual(result.ticketSummary.byPriority, { p1: 1, p2: 1, p3: 8, p4: 0, other: 2 });
});

// "Your work" (FR-6). Distinct created and update times keep the order independent of how a store breaks ties.
const stamp = n => new Date(Date.parse(from) + n * 60_000).toISOString();
function workFixture() {
  const t = (id, n, extra) => ({ ticketId: id, projectId, title: `Work ${id}`, status: 'open', priority: 'medium', visibility: 'project', createdAt: stamp(n), updatedAt: stamp(n + 1000), ...extra });
  return [
    t('W-1', 1, { priority: 'critical', assignee: { id: 'alice' } }),
    t('W-2', 2, { priority: 'high', assignee: 'alice@example.test' }),
    t('W-3', 3, { assignee: { name: 'Alice A' } }),
    t('W-4', 4, { priority: 'low', collaborators: [{ email: 'ALICE@example.test' }] }),
    t('W-5', 5, { priority: 'critical', visibility: 'private', creator: { id: 'bob' }, assignee: { id: 'bob' } }),
    t('W-6', 6, { status: 'closed', assignee: { id: 'alice' } }),
    t('W-7', 7, {}),
    t('W-8', 8, { priority: undefined }),
    t('W-9', 9, { priority: 'P1', updatedAt: stamp(2000) }),
    t('W-10', 10, { pipelineId: 'job-a' }),
    t('W-11', 11, { visibility: 'private', creator: { id: 'bob' }, pipelineId: 'job-b' }),
    t('W-12', 12, { updatedAt: undefined }),
    t('W-13', 13, { assignee: '', collaborators: null, title: undefined, failureSummary: 'Load failed' }),
    t('W-14', 14, { assignee: 'carol' }),
    t('W-15', 15, { collaborators: [{ id: 'dave' }, 'erin@example.test'], priority: 'high' }),
    ...Array.from({ length: 10 }, (_, i) => t(`W-${20 + i}`, 20 + i, { priority: i % 2 ? 'low' : 'medium' })),
  ];
}
const monitorStub = async () => ({ workspaceTotal: 4, recentRuns: [], diagnostics: {}, items: [
  { pipelineId: 'job-a', name: 'Job A', platform: 'databricks', status: 'failed', summary: 'boom', lastRunAt: stamp(3000), lastRunId: 'r1', owner: 'ops' },
  { pipelineId: 'job-b', name: 'Job B', platform: 'databricks', status: 'error', lastRunAt: stamp(1500), lastRunId: 'r2' },
  { pipelineId: 'job-c', name: 'Job C', platform: 'databricks', status: 'healthy' },
  { pipelineId: 'job-d', name: 'Job D', platform: 'snowflake', status: 'delayed', recentRuns: [{ failureSummary: 'late' }] },
] });
const readers = {
  nobody: undefined,
  admin: people.admin,
  alice: { id: 'alice', name: 'Alice A', email: 'alice@example.test', groups: [], roles: [] },
  carol: { id: 'carol@corp.test', groups: [], roles: [] },
  dave: { id: 'dave', groups: [], roles: [] },
  erin: { id: 'erin-id', email: 'erin@example.test', groups: [], roles: [] },
  visitor: people.visitor,
};
async function legacyWork(service, user, scope) { const data = await service.overview(user, { scope }); return { items: data.attentionItems, scope: data.attentionScope }; }
const workOf = ({ generatedAt: _generatedAt, ...rest }) => rest;

async function workParity(service, scope) {
  service.monitor = monitorStub;
  for (const [who, user] of Object.entries(readers)) {
    const after = workOf(await overviewWork(service, user, scope));
    assert.deepEqual(after, await legacyWork(service, user, scope), who);
    assert.ok(after.items.length <= 8, who);
  }
}

async function workService(withMonitor = true) {
  const dir = await tempDir('nc-overview-work-');
  const store = new FileOperationsStore(path.join(dir, 'application-state.json')); await store.init();
  for (const ticket of workFixture()) await store.createTicket(ticket);
  const service = new OperationsService({ store }); if (withMonitor) service.monitor = monitorStub;
  return service;
}

test('ADR 0021: file-store "Your work" equals the load-everything overview for every reader', async () => {
  await workParity(await workService(), systemScope(projectId));
});

test('ADR 0021: "Your work" is the reader\'s own tickets first, never someone else\'s private ones, and skips the monitor when it has them', async () => {
  const service = await workService(false); const scope = systemScope(projectId);
  let monitored = 0; service.monitor = async () => { monitored++; return monitorStub(); };
  const ids = async user => { const r = await overviewWork(service, user, scope); return [r.scope, r.items.map(item => item.ticketId ?? item.pipelineId)]; };
  // Alice: id, email string, name, and collaborator email (any case) all identify her; critical first, then high, medium, low.
  assert.deepEqual(await ids(readers.alice), ['mine', ['W-1', 'W-2', 'W-3', 'W-4']]);
  assert.equal(monitored, 0);
  assert.deepEqual((await ids(readers.carol))[1], ['W-14']);
  assert.deepEqual((await ids(readers.dave))[1], ['W-15']);
  assert.deepEqual((await ids(readers.erin))[1], ['W-15']);
  // The visitor owns nothing: the whole queue of what they may see, plus failing pipelines no visible open ticket covers.
  const [scopeName, visitor] = await ids(readers.visitor);
  assert.equal(scopeName, 'team'); assert.equal(visitor.length, 8);
  assert.ok(!visitor.includes('W-5') && !visitor.includes('W-11'));
  assert.ok(monitored > 0);
  const all = (await overviewWork(service, readers.visitor, scope)).items;
  assert.ok(all.some(item => item.kind === 'pipeline' && item.pipelineId === 'job-b'), 'job-b is only covered by a ticket the visitor cannot see');
  assert.ok(!all.some(item => item.pipelineId === 'job-a'), 'job-a has a visible open ticket');
});

test('ADR 0021: single-user "Your work" lists the whole queue as the reader\'s own', async () => {
  const service = await workService(); const scope = systemScope(projectId);
  const saved = { mode: config.identityMode, id: config.defaultUserId };
  Object.assign(config, { identityMode: 'single-user', defaultUserId: 'solo' });
  try {
    const user = { id: 'solo', groups: [], roles: [] };
    const after = workOf(await overviewWork(service, user, scope));
    assert.deepEqual(after, await legacyWork(service, user, scope));
    assert.equal(after.scope, 'mine');
  } finally { Object.assign(config, { identityMode: saved.mode, defaultUserId: saved.id }); }
});

test('ADR 0021: Postgres Overview counts and "Your work" equal the load-everything path', { skip: !process.env.NC_TEST_DATABASE_URL && 'NC_TEST_DATABASE_URL is not set' }, async () => {
  Object.assign(process.env, { OPS_METADATA_STORE: 'postgres', DATABASE_URL: process.env.NC_TEST_DATABASE_URL, NC_DB_SCHEMA: `nc_overview_${randomBytes(4).toString('hex')}`, OPS_PG_SSL: 'disable' });
  const { createBackend } = await import('../src/bootstrap.mjs');
  const { getPgPool } = await import('../src/storage/postgres.mjs');
  const pool = await getPgPool();
  try {
    const backend = await createBackend();
    await backend.projectStore.create({ id: projectId, name: 'Overview counts' });
    for (const ticket of fixture()) await backend.operationsService.store.createTicket(ticket);
    const service = backend.operationsService; const scope = systemScope(projectId);
    for (const [who, user] of Object.entries(people)) for (const [label, query] of Object.entries({ windowed, unwindowed })) {
      assert.deepEqual(counts(await overviewTickets(service, user, scope, query)), await before(service, user, scope, query), `${who}, ${label}`);
    }
    for (const ticket of workFixture()) await backend.operationsService.store.createTicket(ticket);
    await workParity(service, scope);
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${process.env.NC_DB_SCHEMA} CASCADE`);
    await pool.end();
  }
});

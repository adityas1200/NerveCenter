import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { PostgresOperationsStore } from '../src/app/operations-store.mjs';
import { OperationsService } from '../src/app/operations-service.mjs';
import { ensureControlSchema } from '../src/storage/postgres.mjs';
import { pilot } from './helpers.mjs';

// Runs the ticket signature, recurrence and link code against a real Postgres. Skipped unless
// NC_TEST_DATABASE_URL is set (the shared test environment strips DATABASE_URL on purpose), e.g.
//   docker run -d --name nc-pg -e POSTGRES_PASSWORD=nc -p 55432:5432 postgres:16
//   NC_TEST_DATABASE_URL=postgresql://postgres:nc@localhost:55432/postgres npm test
// Every run works in its own schema and drops it afterwards.
const url = process.env.NC_TEST_DATABASE_URL;
const skip = !url && 'NC_TEST_DATABASE_URL is not set';
const asha = { id: 'asha.rao', name: 'Asha Rao' };
const DAY = 86_400_000;
const daysAgo = days => new Date(Date.now() - days * DAY).toISOString();

let pool; let schema; const made = [];
async function freshStore() {
  schema = `nc_test_${randomBytes(4).toString('hex')}`;
  const { default: pg } = await import('pg');
  const admin = new pg.Pool({ connectionString: url, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`); await admin.end();
  pool = new pg.Pool({ connectionString: url, max: 5, options: `-c search_path=${schema},public` });
  made.push({ pool, schema });
  const store = new PostgresOperationsStore(pool); await store.init();
  return store;
}
test.after(async () => {
  for (const item of made) { await item.pool.query(`DROP SCHEMA IF EXISTS ${item.schema} CASCADE`).catch(() => {}); await item.pool.end(); }
});

test('migrations apply once and boot again applies nothing twice', { skip }, async () => {
  const store = await freshStore();
  const applied = async () => (await pool.query('SELECT name, applied_at FROM ops_schema_migrations ORDER BY name')).rows;
  const first = await applied();
  assert.deepEqual(first.map(row => row.name), ['001-control-schema.sql', '002-ticket-signature.sql', '003-projects.sql', '004-ticket-connection.sql', '005-project-roles.sql', '006-project-access.sql', '007-monitoring-ledger.sql', '008-drop-rbac-audit.sql', '009-per-project-settings.sql', '010-ticket-events.sql', '011-dq-result-key.sql', '012-scheduled-jobs.sql', '013-routine-task-slot.sql', '014-ticket-triage-key.sql']);
  await store.init(); await ensureControlSchema(pool);
  assert.deepEqual(await applied(), first, 'a second boot leaves the migration record untouched');
  const concurrent = await Promise.all([ensureControlSchema(pool), ensureControlSchema(pool), ensureControlSchema(pool)]);
  assert.equal(concurrent.length, 3);
  assert.equal((await applied()).length, first.length);
  const { rows } = await pool.query("SELECT indexdef FROM pg_indexes WHERE schemaname=$1 AND indexname='ops_tickets_signature_idx'", [schema]);
  assert.match(rows[0].indexdef, /data ->> 'signature'/);
});

test('a created ticket is signed, and findTicketsBySignature uses the expression index', { skip }, async () => {
  const store = await freshStore(); const service = new OperationsService({ store });
  const created = await service.createTicket({ scope: pilot, title: 'Territory report shows duplicate HCPs', description: 'Rows repeat after the 6am load', creator: asha, visibility: 'operators' });
  assert.match(created.signature, /^text:[0-9a-f]{16}$/);
  const stored = (await pool.query("SELECT data->>'signature' AS signature FROM ops_tickets WHERE ticket_id=$1", [created.ticketId])).rows[0];
  assert.equal(stored.signature, created.signature);
  assert.deepEqual((await store.findTicketsBySignature(created.signature, pilot)).map(ticket => ticket.ticketId), [created.ticketId]);
  assert.deepEqual(await store.findTicketsBySignature('text:nope', pilot), []); assert.deepEqual(await store.findTicketsBySignature('', pilot), []);

  // Enough rows (and a null-signature majority) for the planner to have a choice, then ask it how it would run the query.
  await pool.query(`INSERT INTO ops_tickets(ticket_id,status,project_id,data) SELECT 'BULK-'||g, 'open', 'pilot', jsonb_build_object('ticketId','BULK-'||g,'signature','text:'||g) FROM generate_series(1,2000) g`);
  await pool.query(`INSERT INTO ops_tickets(ticket_id,status,project_id,data) SELECT 'NULL-'||g, 'open', 'pilot', jsonb_build_object('ticketId','NULL-'||g) FROM generate_series(1,2000) g`);
  await pool.query('ANALYZE ops_tickets');
  const plan = async () => (await pool.query("EXPLAIN SELECT data FROM ops_tickets WHERE data->>'signature'='text:42' ORDER BY created_at DESC LIMIT 200")).rows.map(row => row['QUERY PLAN']).join('\n');
  assert.match(await plan(), /ops_tickets_signature_idx/, 'the partial expression index serves the lookup');
  assert.equal((await store.findTicketsBySignature('text:42', pilot)).length, 1);
});

test('backfill signs old tickets without moving updatedAt, in the data and in the column', { skip }, async () => {
  const store = await freshStore(); const service = new OperationsService({ store });
  const base = { status: 'open', priority: 'high', activity: [], createdAt: daysAgo(40), updatedAt: daysAgo(40), visibility: 'operators' };
  await store.createTicket({ projectId: 'pilot', ...base, ticketId: 'OPS-1', title: 'Nightly load failed for orders', description: 'Timeout reading orders' });
  await store.createTicket({ projectId: 'pilot', ...base, ticketId: 'OPS-2', title: 'x' });
  const column = async id => (await pool.query('SELECT updated_at FROM ops_tickets WHERE ticket_id=$1', [id])).rows[0].updated_at.toISOString();
  const before = await column('OPS-1');
  assert.equal(await service.backfillSignatures(), 2);
  const [one, two] = [await store.getTicket('OPS-1'), await store.getTicket('OPS-2')];
  assert.match(one.signature, /^text:/); assert.equal(two.signature, null);
  assert.equal(one.updatedAt, base.updatedAt); assert.equal(await column('OPS-1'), before);
  assert.equal(await service.backfillSignatures(), 0, 'a second pass finds nothing to sign');
  assert.deepEqual((await store.findTicketsBySignature(one.signature, pilot)).map(ticket => ticket.ticketId), ['OPS-1']);
  // touch defaults to true, and moves both
  const touched = await store.updateTicket('OPS-1', { priority: 'low' });
  assert.notEqual(touched.updatedAt, base.updatedAt); assert.notEqual(await column('OPS-1'), before);
});

test('a repeat of a recently resolved failure is flagged, and the link is stored on both tickets', { skip }, async () => {
  const store = await freshStore(); const service = new OperationsService({ store });
  const first = await service.createTicket({ scope: pilot, title: 'Territory report shows duplicate HCPs', description: 'Rows repeat after the 6am load', creator: asha, visibility: 'operators' });
  await store.updateTicket(first.ticketId, { status: 'resolved', resolutionSummary: 'Added a dedupe step.', closedAt: daysAgo(5) }, { touch: false });
  const again = await service.createTicket({ scope: pilot, title: 'Territory report shows duplicate HCPs', description: 'Rows repeat after the 6am load', creator: asha, visibility: 'operators' });

  const [a, b] = [await store.getTicket(again.ticketId), await store.getTicket(first.ticketId)];
  assert.deepEqual(a.links.map(({ relation, direction, ticketId, auto }) => ({ relation, direction, ticketId, auto })), [{ relation: 'recurrence_of', direction: 'out', ticketId: first.ticketId, auto: true }]);
  assert.deepEqual(b.links.map(({ relation, direction, ticketId }) => ({ relation, direction, ticketId })), [{ relation: 'recurrence_of', direction: 'in', ticketId: again.ticketId }]);
  assert.match(a.activity.find(event => event.type === 'ticket.recurrence').detail, /Added a dedupe step/);
  assert.ok(b.activity.some(event => event.type === 'ticket.recurrence'));
  assert.equal(b.status, 'resolved', 'the earlier ticket stays resolved');

  // Outside the window it is not a recurrence.
  const old = await service.createTicket({ scope: pilot, title: 'Quarterly rebate load failed', description: 'rebate load failed in the quarterly job', creator: asha, visibility: 'operators' });
  await store.updateTicket(old.ticketId, { status: 'closed', closedAt: daysAgo(90) }, { touch: false });
  const late = await service.createTicket({ scope: pilot, title: 'Quarterly rebate load failed', description: 'rebate load failed in the quarterly job', creator: asha, visibility: 'operators' });
  assert.deepEqual((await store.getTicket(late.ticketId)).links || [], []);
});

test('linkTickets persists both directions and refuses a duplicate link', { skip }, async () => {
  const store = await freshStore(); const service = new OperationsService({ store });
  const mk = title => service.createTicket({ scope: pilot, title, description: `${title} details`, creator: asha, visibility: 'operators' });
  const [x, y] = [await mk('Orders feed missing'), await mk('Printer queue stuck')];
  const rbacUser = { ...asha };
  const result = await service.linkTickets(x.ticketId, y.ticketId, { relation: 'related_to', user: rbacUser, scope: pilot });
  assert.equal(result.linked, true);
  const [a, b] = [await store.getTicket(x.ticketId), await store.getTicket(y.ticketId)];
  assert.deepEqual(a.links.map(link => [link.relation, link.direction, link.ticketId]), [['related_to', 'out', y.ticketId]]);
  assert.deepEqual(b.links.map(link => [link.relation, link.direction, link.ticketId]), [['related_to', 'in', x.ticketId]]);
  assert.ok(a.activity.some(event => event.type === 'ticket.link') && b.activity.some(event => event.type === 'ticket.link'));
  assert.equal((await service.linkTickets(x.ticketId, y.ticketId, { relation: 'related_to', user: rbacUser, scope: pilot })).linked, false);
  assert.equal((await store.getTicket(y.ticketId)).links.length, 1);
});

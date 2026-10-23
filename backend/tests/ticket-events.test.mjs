import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { FileOperationsStore, PostgresOperationsStore } from '../src/app/operations-store.mjs';
import { applyFileMigrations } from '../src/storage/file-migrations.mjs';
import { systemScope } from '../src/projects/project-access.mjs';
import { MIGRATIONS_DIR } from '../src/config.mjs';
import { tempDir } from './helpers.mjs';

// ADR 0005: a ticket's activity is one record per event, outside the ticket. These tests cover both stores, the
// file migration and the SQL migration text. Nothing here touches a real Postgres.
const tmp = await tempDir('nc-ticket-events-');
const scope = systemScope('pilot');
const ticket = (id, extra = {}) => ({ ticketId: id, projectId: 'pilot', title: id, status: 'open', createdAt: '2026-01-01T00:00:00.000Z', ...extra });
const comment = (n, at = `2026-02-01T00:00:${String(n % 60).padStart(2, '0')}.000Z`) => ({ id: `e${n}`, type: 'ticket.comment', title: `c${n}`, detail: `note ${n}`, at });
async function fileStore(name) { const store = new FileOperationsStore(path.join(tmp, name, 'application-state.json')); await store.init(); return store; }
const read = async file => JSON.parse(await fs.readFile(file, 'utf8'));

test('ADR 0005: concurrent appendActivity calls on one ticket all land with unique seq 1..n', async () => {
  const store = await fileStore('concurrent');
  await store.createTicket(ticket('OPS-1'));
  await Promise.all(Array.from({ length: 20 }, (_, i) => store.appendActivity('OPS-1', [{ type: 'ticket.comment', title: `c${i}`, at: `2026-02-01T00:00:${String(i).padStart(2, '0')}.000Z` }])));
  const activity = (await store.getTicket('OPS-1')).activity;
  assert.equal(activity.length, 20);
  assert.deepEqual(activity.map(event => event.seq), Array.from({ length: 20 }, (_, i) => i + 1));
  assert.equal(new Set(activity.map(event => event.id)).size, 20);
  assert.ok(activity.every(event => event.ticketId === 'OPS-1' && event.id && event.at));
});

test('ADR 0005: lists and finders carry the activity of each ticket (latest 500, oldest first); the state file holds none', async () => {
  const store = await fileStore('lists');
  await store.createTicket(ticket('OPS-1', { activity: [comment(1), comment(2)], signature: 'sig', sourceRef: 'ref-1' }));
  await store.createTicket(ticket('OPS-2', { activity: Array.from({ length: 520 }, (_, i) => comment(i + 1)), signature: 'sig' }));
  await store.appendActivity('OPS-1', [comment(3)]);
  const listed = await store.listTickets(scope);
  assert.deepEqual(listed.find(row => row.ticketId === 'OPS-1').activity.map(event => event.id), ['e1', 'e2', 'e3']);
  const long = listed.find(row => row.ticketId === 'OPS-2').activity;
  assert.equal(long.length, 500); assert.equal(long[0].id, 'e21'); assert.equal(long.at(-1).id, 'e520');
  assert.equal((await store.findTicketsBySignature('sig', scope)).every(row => row.activity.length > 0), true);
  assert.equal((await store.findTicketBySourceRef('ref-1')).activity.length, 3);
  assert.deepEqual((await store.getTicket('OPS-1')).activity.map(event => event.id), ['e1', 'e2', 'e3']);
  const state = await read(path.join(tmp, 'lists', 'application-state.json'));
  assert.equal('activity' in state.tickets['OPS-1'], false);
});

test('ADR 0005: getTicket returns at most the latest 500 events, oldest first', async () => {
  const store = await fileStore('cap');
  await store.createTicket(ticket('OPS-1', { activity: Array.from({ length: 520 }, (_, i) => comment(i + 1, new Date(Date.UTC(2026, 1, 1) + i * 1000).toISOString())) }));
  const activity = (await store.getTicket('OPS-1')).activity;
  assert.equal(activity.length, 500);
  assert.equal(activity[0].id, 'e21'); assert.equal(activity.at(-1).id, 'e520');
  assert.equal((await store.listActivity(['OPS-1'], { limit: 99999 })).length, 520);
});

test('ADR 0005: listActivity filters by types and since, is newest first, bounded, and empty for no ids', async () => {
  const store = await fileStore('listactivity');
  await store.createTicket(ticket('OPS-1', { activity: [comment(1, '2026-02-01T00:00:01.000Z'), { id: 's1', type: 'ticket.status', at: '2026-02-01T00:00:02.000Z' }, comment(3, '2026-02-01T00:00:03.000Z')] }));
  await store.createTicket(ticket('OPS-2', { activity: [comment(4, '2026-02-01T00:00:04.000Z')] }));
  const all = await store.listActivity(['OPS-1', 'OPS-2']);
  assert.deepEqual(all.map(event => event.id), ['e4', 'e3', 's1', 'e1']);
  assert.deepEqual(all.map(event => event.ticketId), ['OPS-2', 'OPS-1', 'OPS-1', 'OPS-1']);
  assert.deepEqual((await store.listActivity(['OPS-1', 'OPS-2'], { types: ['ticket.comment'] })).map(event => event.id), ['e4', 'e3', 'e1']);
  assert.deepEqual((await store.listActivity(['OPS-1', 'OPS-2'], { since: '2026-02-01T00:00:02.000Z' })).map(event => event.id), ['e4', 'e3']);
  assert.equal((await store.listActivity(['OPS-1', 'OPS-2'], { limit: 2 })).length, 2);
  assert.deepEqual(await store.listActivity([]), []);
  assert.deepEqual(await store.listActivity(['OPS-404']), []);
});

test('ADR 0005: updateTicket with an activity patch throws and appendActivity on a missing ticket says so', async () => {
  const store = await fileStore('reject');
  await store.createTicket(ticket('OPS-1'));
  await assert.rejects(() => store.updateTicket('OPS-1', { activity: [] }), /appended with appendActivity/);
  await assert.rejects(() => store.appendActivity('OPS-9', [comment(1)]), /Ticket not found: OPS-9/);
  const after = await store.appendActivity('OPS-1', [comment(1)]);
  assert.equal(after.activity.length, 1); assert.ok(after.updatedAt);
});

test('ADR 0005: re-importing a ticket by its source key keeps the old events and adds none', async () => {
  const store = await fileStore('reimport');
  const first = await store.createTicket(ticket('OPS-1', { source: 'servicenow', sourceRef: 'INC1', sourceKey: 'servicenow:abc', activity: [comment(1), comment(2)] }));
  assert.equal(first.activity.length, 2);
  const again = await store.createTicket(ticket('OPS-2', { source: 'servicenow', sourceRef: 'INC1', sourceKey: 'servicenow:abc', title: 'Refreshed', activity: [comment(9)] }));
  assert.equal(again.ticketId, 'OPS-1'); assert.equal(again.title, 'Refreshed');
  assert.deepEqual(again.activity.map(event => event.id), ['e1', 'e2']);
  assert.deepEqual((await store.getTicket('OPS-1')).activity.map(event => event.id), ['e1', 'e2']);
  assert.equal(await store.getTicket('OPS-2'), null);
});

async function legacyRuntime(name) {
  const runtimeDir = path.join(tmp, name); await fs.mkdir(runtimeDir, { recursive: true });
  const state = { ticketCounter: 1002, other: { a: 1 }, tickets: {
    'OPS-1': { ticketId: 'OPS-1', projectId: 'pilot', title: 'Old', createdAt: '2026-01-01T00:00:00.000Z', links: [{ ticketId: 'OPS-2' }], activity: [{ id: 'x1', type: 'ticket.created', at: '2026-01-01T00:00:01.000Z', title: 'Opened' }, { title: 'Bare' }] },
    'OPS-2': { ticketId: 'OPS-2', projectId: 'pilot', title: 'Quiet', createdAt: '2026-01-02T00:00:00.000Z' },
  } };
  await fs.writeFile(path.join(runtimeDir, 'application-state.json'), JSON.stringify(state));
  return runtimeDir;
}

test('ADR 0005: file migration 010 moves activity to ticket-events with defaults and seq, and leaves other fields alone', async () => {
  const runtimeDir = await legacyRuntime('mig-file');
  assert.ok((await applyFileMigrations({ runtimeDir })).ran.includes('010-ticket-events.mjs'));
  const events = await read(path.join(runtimeDir, 'ticket-events', 'OPS-1.json'));
  assert.deepEqual(events.map(event => event.seq), [1, 2]);
  assert.deepEqual(events[0], { id: 'x1', type: 'ticket.created', at: '2026-01-01T00:00:01.000Z', title: 'Opened', ticketId: 'OPS-1', seq: 1 });
  assert.deepEqual(events[1], { title: 'Bare', id: 'OPS-1-2', at: '2026-01-01T00:00:00.000Z', type: 'ticket.event', ticketId: 'OPS-1', seq: 2 });
  const state = await read(path.join(runtimeDir, 'application-state.json'));
  assert.equal('activity' in state.tickets['OPS-1'], false);
  assert.deepEqual(state.tickets['OPS-1'].links, [{ ticketId: 'OPS-2' }]);
  assert.equal(state.tickets['OPS-1'].title, 'Old'); assert.deepEqual(state.other, { a: 1 }); assert.equal(state.ticketCounter, 1002);
  await assert.rejects(() => fs.stat(path.join(runtimeDir, 'ticket-events', 'OPS-2.json')));
  // The store reads what the migration wrote.
  const store = new FileOperationsStore(path.join(runtimeDir, 'application-state.json'));
  assert.deepEqual((await store.getTicket('OPS-1')).activity.map(event => event.id), ['x1', 'OPS-1-2']);
});

test('ADR 0005: file migration 010 run twice changes nothing, and an existing events file is not duplicated', async () => {
  const runtimeDir = await legacyRuntime('mig-twice');
  const { up } = await import(`${path.join(MIGRATIONS_DIR, '010-ticket-events.mjs').replace(/\\/g, '/').replace(/^([A-Za-z]):/, 'file:///$1:')}`);
  await up({ runtimeDir });
  const snapshot = async () => [await fs.readFile(path.join(runtimeDir, 'application-state.json'), 'utf8'), await fs.readFile(path.join(runtimeDir, 'ticket-events', 'OPS-1.json'), 'utf8')];
  const once = await snapshot();
  await up({ runtimeDir });
  assert.deepEqual(await snapshot(), once);

  // A crash between writing the events and removing `activity` leaves both; the rerun only removes `activity`.
  const crashed = await legacyRuntime('mig-crash');
  await fs.mkdir(path.join(crashed, 'ticket-events'), { recursive: true });
  const existing = [{ id: 'x1', type: 'ticket.created', at: '2026-01-01T00:00:01.000Z', ticketId: 'OPS-1', seq: 1 }];
  await fs.writeFile(path.join(crashed, 'ticket-events', 'OPS-1.json'), JSON.stringify(existing));
  await up({ runtimeDir: crashed });
  assert.deepEqual(await read(path.join(crashed, 'ticket-events', 'OPS-1.json')), existing);
  assert.equal('activity' in (await read(path.join(crashed, 'application-state.json'))).tickets['OPS-1'], false);
});

// A pool stand-in that answers the statements the store sends and records them.
function fakePool({ failInsert = 0 } = {}) {
  const calls = []; let failures = failInsert;
  return {
    calls,
    async query(sql, params = []) {
      const text = sql.replace(/\s+/g, ' ').trim(); calls.push({ text, params });
      if (text.startsWith('UPDATE ops_tickets SET updated_at=now(),data=jsonb_set')) return { rows: [], rowCount: params[0] === 'OPS-1' ? 1 : 0 };
      if (text.startsWith('INSERT INTO ops_ticket_events')) { if (failures > 0) { failures -= 1; throw Object.assign(new Error('duplicate key'), { code: '23505' }); } return { rows: [], rowCount: 1 }; }
      if (text.includes('FROM ops_ticket_events')) return { rows: params[0].flatMap?.(id => [{ ticket_id: id, data: { id: `${id}-e1`, type: 'ticket.comment', ticketId: id, seq: 1 } }]) || [] };
      if (text.includes('FROM ops_tickets WHERE project_id = ANY($1) ORDER BY created_at DESC')) return { rows: ['OPS-1', 'OPS-2', 'OPS-3'].map(id => ({ data: ticket(id) })) };
      if (text.includes('FROM ops_tickets WHERE ticket_id=$1')) return { rows: [{ data: ticket(params[0]) }] };
      return { rows: [], rowCount: 0 };
    },
  };
}

test('ADR 0005: Postgres appendActivity sends the MAX+1 insert and retries once on a key clash', async () => {
  const pool = fakePool({ failInsert: 1 }); const store = new PostgresOperationsStore(pool);
  const result = await store.appendActivity('OPS-1', [{ type: 'ticket.comment', title: 'hi' }]);
  const inserts = pool.calls.filter(call => call.text.startsWith('INSERT INTO ops_ticket_events'));
  assert.equal(inserts.length, 2);
  assert.match(inserts[0].text, /COALESCE\(MAX\(seq\),0\)\+1/);
  assert.equal(inserts[0].params[0], 'OPS-1'); assert.equal(inserts[0].params[3], 'ticket.comment');
  assert.equal(JSON.parse(inserts[0].params[4]).ticketId, 'OPS-1');
  assert.equal(result.ticketId, 'OPS-1'); assert.ok(Array.isArray(result.activity));
  assert.ok(pool.calls.some(call => call.text.startsWith('UPDATE ops_tickets SET updated_at=now()')));
  await assert.rejects(() => store.appendActivity('OPS-9', [comment(1)]), /Ticket not found: OPS-9/);
  await assert.rejects(() => new PostgresOperationsStore(fakePool({ failInsert: 5 })).appendActivity('OPS-1', [comment(1)]), /duplicate key/);
});

test('ADR 0005: Postgres listTickets loads the latest 500 events of every ticket with ONE windowed query', async () => {
  const pool = fakePool(); const store = new PostgresOperationsStore(pool);
  const rows = await store.listTickets(scope);
  assert.deepEqual(rows.map(row => row.ticketId), ['OPS-1', 'OPS-2', 'OPS-3']);
  assert.deepEqual(rows.map(row => row.activity.map(event => event.id)), [['OPS-1-e1'], ['OPS-2-e1'], ['OPS-3-e1']]);
  const eventQueries = pool.calls.filter(call => call.text.includes('FROM ops_ticket_events'));
  assert.equal(eventQueries.length, 1);
  assert.match(eventQueries[0].text, /WHERE ticket_id = ANY\(\$1\)/);
  assert.match(eventQueries[0].text, /row_number\(\) OVER \(PARTITION BY ticket_id ORDER BY seq DESC\) AS rn/);
  assert.match(eventQueries[0].text, /WHERE rn <= \$2 ORDER BY ticket_id, seq/);
  assert.deepEqual(eventQueries[0].params, [['OPS-1', 'OPS-2', 'OPS-3'], 500]);
});

test('ADR 0005: Postgres listActivity uses ticket_id = ANY($1) with a capped limit and no query for no ids', async () => {
  const pool = fakePool(); const store = new PostgresOperationsStore(pool);
  assert.deepEqual(await store.listActivity([]), []);
  assert.equal(pool.calls.length, 0);
  await store.listActivity(['OPS-1', 'OPS-2'], { types: ['ticket.comment'], since: '2026-02-01T00:00:00.000Z', limit: 99999 });
  const { text, params } = pool.calls[0];
  assert.match(text, /WHERE ticket_id = ANY\(\$1\) AND type = ANY\(\$2\) AND at > \$3 ORDER BY at DESC, seq DESC LIMIT \$4/);
  assert.deepEqual(params, [['OPS-1', 'OPS-2'], ['ticket.comment'], '2026-02-01T00:00:00.000Z', 10000]);
  await store.listActivity(['OPS-1']);
  assert.equal(pool.calls[1].params.at(-1), 2000);
  await assert.rejects(() => store.updateTicket('OPS-1', { activity: [] }), /appended with appendActivity/);
});

test('ADR 0005: SQL migration 010 creates the table, then backfills in array order, then drops activity from the ticket', async () => {
  const sql = await fs.readFile(path.join(MIGRATIONS_DIR, '010-ticket-events.sql'), 'utf8');
  const create = sql.indexOf('CREATE TABLE IF NOT EXISTS ops_ticket_events');
  const backfill = sql.indexOf('INSERT INTO ops_ticket_events');
  const strip = sql.indexOf("UPDATE ops_tickets SET data = data - 'activity'");
  assert.ok(create >= 0 && backfill > create && strip > backfill);
  assert.match(sql, /REFERENCES ops_tickets\(ticket_id\) ON DELETE CASCADE/);
  assert.match(sql, /PRIMARY KEY \(ticket_id, seq\)/);
  assert.match(sql, /ops_ticket_events_at_idx ON ops_ticket_events \(ticket_id, at DESC\)/);
  assert.match(sql, /WITH ORDINALITY/);
  assert.match(sql, /ON CONFLICT DO NOTHING/);
  assert.match(sql, /jsonb_typeof\(t\.data->'activity'\) = 'array'/);
  assert.match(sql, /t\.created_at/); assert.match(sql, /'ticket\.event'/); assert.match(sql, /t\.ticket_id \|\| '-' \|\| e\.seq/);
  assert.match(sql, /WHERE data \? 'activity'/);
});

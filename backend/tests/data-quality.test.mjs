import test from 'node:test';
import { pilot } from './helpers.mjs';
import assert from 'node:assert/strict';
import { DataQualityService, readTables } from '../src/data-quality/data-quality-service.mjs';

const mapping = { checkId: 'check_id', status: 'status', executedAt: 'run_at', checkName: 'check_name', dataset: 'table_name' };
const legacy = { provider: 'databricks', catalog: 'commercial', schema: 'ops_monitoring', resultTable: 'dq_results', ruleTable: null, warehouseId: 'wh-1', mapping, enabled: true, updatedAt: '2026-09-24T05:10:49.464Z' };

function memoryStore(initial) {
  let setting = initial === undefined ? null : structuredClone(initial);
  const tickets = [];
  return {
    get raw() { return setting; },
    tickets,
    async getDataQualityConfig() { return setting ? structuredClone(setting) : null; },
    async setDataQualityConfig(value) { setting = structuredClone(value); return structuredClone(setting); },
    async findTicketBySourceRef(ref) { return tickets.find(ticket => ticket.sourceRef === ref) || null; },
  };
}

// Rows per fully qualified table; the fake warehouse answers by the FROM clause.
function service(store, rowsByTable, { ready = ['databricks', 'snowflake'] } = {}) {
  const statements = [];
  const queryRows = async ({ statement }) => {
    statements.push(statement);
    const from = /FROM\s+(\S+)/.exec(statement)?.[1].replace(/[`"]/g, '');
    if (!(from in rowsByTable)) throw new Error(`table not found: ${from}`);
    return rowsByTable[from];
  };
  const dq = new DataQualityService({
    store,
    connectionService: {
      providerStatuses: async () => ready.map(id => ({ id, name: id, state: 'available', ready: true, source: 'deployment' })),
      resolve: async provider => (ready.includes(provider) ? { config: { warehouse: 'WH' }, credentials: {} } : null),
    },
    databricksFactory: () => ({ queryRows }),
    snowflakeFactory: () => ({ queryRows }),
    ddlMappingAgent: { suggest: async () => ({ used: false }) },
  });
  return { dq, statements };
}

const recent = minutesAgo => new Date(Date.now() - minutesAgo * 60_000).toISOString();

test('the old single configuration is read as a one-table list', async () => {
  assert.deepEqual(readTables(null), []);
  assert.deepEqual(readTables({}), []);
  const [table] = readTables(legacy);
  assert.equal(table.id, 'dq-1'); assert.equal(table.name, 'dq_results'); assert.equal(table.catalog, 'commercial'); assert.equal(table.enabled, true);
  const store = memoryStore(legacy);
  const { dq } = service(store, {});
  const tables = await dq.listTables();
  assert.equal(tables.length, 1);
  assert.equal((await dq.getConfig()).resultTable, 'dq_results');
  // Reading never rewrites the stored value.
  assert.equal(store.raw.tables, undefined);
});

test('saving adds a second table next to the migrated one and updates by id', async () => {
  const store = memoryStore(legacy);
  const { dq } = service(store, {});
  const added = await dq.saveConfig({ name: 'Snowflake checks', provider: 'snowflake', catalog: 'COMMERCIAL', schema: 'QUALITY', resultTable: 'DQ_LOG', mapping: { checkId: 'CHECK_ID', status: 'STATUS', executedAt: 'EXECUTED_AT' } });
  assert.match(added.id, /^dq-/); assert.notEqual(added.id, 'dq-1'); assert.equal(added.name, 'Snowflake checks');
  assert.equal(store.raw.tables.length, 2);
  assert.equal(store.raw.tables[0].id, 'dq-1'); assert.equal(store.raw.tables[0].resultTable, 'dq_results');

  const paused = await dq.saveConfig({ id: added.id, enabled: false });
  assert.equal(paused.enabled, false); assert.equal(paused.resultTable, 'DQ_LOG'); assert.equal(paused.name, 'Snowflake checks');
  assert.equal(store.raw.tables.length, 2);
  assert.equal((await dq.getConfig()).id, 'dq-1');

  await assert.rejects(dq.saveConfig({ provider: 'databricks', catalog: 'commercial', schema: 'ops_monitoring', resultTable: 'DQ_RESULTS', warehouseId: 'wh-1', mapping }), /already configured/);
  const { dq: offline } = service(store, {}, { ready: [] });
  await assert.rejects(offline.saveConfig({ id: added.id, enabled: true }), /connected Databricks or Snowflake/);
  assert.equal((await offline.saveConfig({ id: 'dq-1', enabled: false })).enabled, false);
});

test('deleting removes one table', async () => {
  const store = memoryStore({ tables: [{ ...legacy, id: 'a', name: 'A' }, { ...legacy, id: 'b', name: 'B', resultTable: 'other' }] });
  const { dq } = service(store, {});
  assert.deepEqual(await dq.deleteConfig('a'), { id: 'a', deleted: true });
  assert.deepEqual((await dq.listTables()).map(table => table.id), ['b']);
  await assert.rejects(dq.deleteConfig('missing'), error => error.statusCode === 404);
});

test('monitor merges the checks of every enabled table and tags each with its table', async () => {
  const store = memoryStore({ tables: [
    { ...legacy, id: 'dbx', name: 'Commercial checks' },
    { id: 'sf', name: 'Warehouse checks', provider: 'snowflake', catalog: 'DW', schema: 'Q', resultTable: 'LOG', mapping: { checkId: 'CHECK_ID', status: 'STATUS', executedAt: 'EXECUTED_AT' }, enabled: true },
    { ...legacy, id: 'off', name: 'Paused', resultTable: 'paused', enabled: false },
  ] });
  const { dq, statements } = service(store, {
    'commercial.ops_monitoring.dq_results': [{ check_id: 'DQ-001', status: 'fail', executed_at: recent(30) }, { check_id: 'DQ-002', status: 'pass', executed_at: recent(90) }],
    'DW.Q.LOG': [{ check_id: 'DQ-001', status: 'warn', executed_at: recent(10) }],
  });
  const result = await dq.monitor({ range: 'Last 24 hours' });
  assert.equal(result.configured, true);
  assert.deepEqual(result.summary, { total: 3, passed: 1, failed: 1, warning: 1, unreported: 0 });
  assert.deepEqual(result.items.map(item => [item.checkId, item.tableId, item.table, item.platform]), [
    ['DQ-001', 'sf', 'Warehouse checks', 'snowflake'],
    ['DQ-001', 'dbx', 'Commercial checks', 'databricks'],
    ['DQ-002', 'dbx', 'Commercial checks', 'databricks'],
  ]);
  assert.equal(result.configuration.id, 'dbx'); assert.equal(result.configuration.resultTable, 'dq_results');
  assert.deepEqual(result.tables.map(table => [table.id, table.enabled]), [['dbx', true], ['sf', true], ['off', false]]);
  assert.equal(result.tables[0].ddl, undefined);
  assert.deepEqual(result.sources.map(source => [source.tableId, source.status, source.count]), [['dbx', 'ok', 2], ['sf', 'ok', 1]]);
  assert.equal(statements.some(statement => statement.includes('paused')), false);

  // The same check id in two tables links to two different tickets.
  const reconciled = await dq.reconcile({ range: 'Last 24 hours', scope: pilot });
  const failed = reconciled.items.filter(item => item.status === 'failed');
  assert.equal(failed.length, 1); assert.match(failed[0].routing.sourceRef, /^dq-table:/); assert.equal(failed[0].ticketAction, 'investigate');
  store.tickets.push({ ticketId: 'OPS-9', projectId: 'pilot', sourceRef: failed[0].routing.sourceRef, status: 'open' });
  const linked = (await dq.reconcile({ range: 'Last 24 hours', scope: pilot })).items.find(item => item.status === 'failed');
  assert.equal(linked.ticket.ticketId, 'OPS-9'); assert.equal(linked.ticketAction, 'view');
});

test('the migrated table keeps the ticket link it had before several tables existed', async () => {
  const rows = { 'commercial.ops_monitoring.dq_results': [{ check_id: 'DQ-001', status: 'fail', executed_at: recent(5) }] };
  const before = (await service(memoryStore(legacy), rows).dq.reconcile({ range: 'Last 24 hours', scope: pilot })).items[0].routing.sourceRef;
  const after = (await service(memoryStore({ tables: [{ ...legacy, id: 'renamed', name: 'Renamed' }] }), rows).dq.reconcile({ range: 'Last 24 hours', scope: pilot })).items[0].routing.sourceRef;
  assert.equal(before, after);
});

test('one unreadable table does not hide the others; all unreadable reports unavailable', async () => {
  const tables = [{ ...legacy, id: 'ok', name: 'Readable' }, { ...legacy, id: 'bad', name: 'Missing', resultTable: 'gone' }];
  const { dq } = service(memoryStore({ tables }), { 'commercial.ops_monitoring.dq_results': [{ check_id: 'DQ-1', status: 'pass', executed_at: recent(1) }] });
  const partial = await dq.monitor({ range: 'Last 24 hours' });
  assert.equal(partial.configured, true); assert.equal(partial.items.length, 1);
  assert.match(partial.source.reason, /Read 1 of 2 result tables/);
  assert.deepEqual(partial.sources.map(source => source.status), ['ok', 'unavailable']);

  const { dq: none } = service(memoryStore({ tables }), {});
  const empty = await none.monitor({ range: 'Last 24 hours' });
  assert.equal(empty.configured, false); assert.equal(empty.source.mode, 'unavailable'); assert.equal(empty.configuration.id, 'ok');

  const { dq: unconfigured } = service(memoryStore(null), {});
  const nothing = await unconfigured.monitor({});
  assert.equal(nothing.configured, false); assert.equal(nothing.source.mode, 'unconfigured'); assert.deepEqual(nothing.tables, []);
});

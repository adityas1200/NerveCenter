import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileOperationsStore } from '../src/app/operations-store.mjs';
import { FileTaskStore } from '../src/tasks/task-store.mjs';
import { BoardService } from '../src/boards/board-service.mjs';
import { createAppTools } from '../src/tasks/nervecenter-tools.mjs';
import { fakeMcpSdk, tempDir, pilot } from './helpers.mjs';

// Before Sonic writes SQL for a board widget it looks up the real tables and columns, so the SQL is built
// from the schema instead of guessed. These cover the lookup, its limits, its cache and who may use it.

const tmp = await tempDir('nc-board-data-');
const builder = { id: 'priya', name: 'Priya Nair', role: 'developer' };
const viewer = { id: 'devon', name: 'Devon Blake', role: 'viewer' };

function fakePlatform({ tables = 3, columns = 4 } = {}) {
  const calls = { list: [], get: [] };
  const platform = {
    async listTables(args) { calls.list.push(args); return Array.from({ length: Math.min(tables, args.limit) }, (_, i) => ({ id: `commercial.gold.table_${i}`, platform: 'databricks', kind: 'table', comment: i === 0 ? 'Daily Veltrix sales' : null, rowCount: null, owner: 'etl', location: 's3://secret-bucket/x' })); },
    async getTable(args) { calls.get.push(args); if (args.objectId === 'commercial.gold.missing') throw new Error('Databricks GET /api/2.1/unity-catalog/tables failed (404): TABLE_DOES_NOT_EXIST'); return { id: args.objectId, platform: 'databricks', kind: 'table', comment: 'Daily Veltrix sales', rowCount: null, lastAlteredAt: '2026-09-29T04:00:00.000Z', ddl: 'CREATE TABLE ...', upstream: ['commercial.silver.x'], columns: Array.from({ length: columns }, (_, i) => ({ name: `col_${i}`, type: i === 0 ? 'timestamp' : 'bigint', comment: i === 0 ? 'When the row was loaded' : null, nullable: true, position: i })) }; },
  };
  return { platform, calls };
}

async function service({ dataPlatform, now = { t: Date.parse('2026-09-30T10:00:00Z') } } = {}) {
  const store = new FileOperationsStore(path.join(tmp, `ops-${Math.random().toString(36).slice(2, 8)}`)); await store.init();
  return new BoardService({ store, dataPlatform, clock: () => now.t });
}

test('the lookup lists tables in a schema, and one table\'s columns with types and comments', async () => {
  const { platform, calls } = fakePlatform();
  const boards = await service({ dataPlatform: platform });
  const listed = await boards.describeData({ provider: 'databricks', schema: 'gold', search: 'table' }, builder);
  assert.deepEqual(listed.tables.map(item => item.id), ['commercial.gold.table_0', 'commercial.gold.table_1', 'commercial.gold.table_2']);
  assert.equal(listed.tables[0].comment, 'Daily Veltrix sales');
  assert.equal(listed.tables[0].location, undefined, 'storage locations and owners are not part of the answer');
  assert.equal(calls.list[0].schema, 'gold'); assert.equal(calls.list[0].search, 'table');
  const one = await boards.describeData({ provider: 'databricks', table: 'commercial.gold.veltrix_sales_daily' }, builder);
  assert.deepEqual(one.table.columns[0], { name: 'col_0', type: 'timestamp', comment: 'When the row was loaded' });
  assert.equal(one.table.ddl, undefined, 'the answer holds columns, not DDL or lineage');
});

test('answers stay small: at most 50 tables and 100 columns, with a note when more exist', async () => {
  const { platform } = fakePlatform({ tables: 80, columns: 130 });
  const boards = await service({ dataPlatform: platform });
  const listed = await boards.describeData({}, builder);
  assert.equal(listed.tables.length, 50); assert.equal(listed.more, true); assert.match(listed.hint, /narrow the search/);
  const one = await boards.describeData({ table: 'commercial.gold.wide' }, builder);
  assert.equal(one.table.columns.length, 100); assert.equal(one.table.moreColumns, 30);
});

test('a repeat lookup within a minute is served from cache, and a new one after that asks the platform again', async () => {
  const { platform, calls } = fakePlatform();
  const now = { t: Date.parse('2026-09-30T10:00:00Z') };
  const boards = await service({ dataPlatform: platform, now });
  await boards.describeData({ schema: 'gold' }, builder);
  await boards.describeData({ schema: 'gold' }, builder);
  assert.equal(calls.list.length, 1, 'the second call within 60 seconds does not reach the platform');
  await boards.describeData({ schema: 'silver' }, builder);
  assert.equal(calls.list.length, 2, 'a different question is not answered from the cache');
  now.t += 61_000;
  await boards.describeData({ schema: 'gold' }, builder);
  assert.equal(calls.list.length, 3);
});

test('viewers cannot look up tables, and a missing platform or table gives a plain error', async () => {
  const { platform } = fakePlatform();
  const boards = await service({ dataPlatform: platform });
  await assert.rejects(boards.describeData({}, viewer), { statusCode: 403 });
  await assert.rejects((await service()).describeData({}, builder), /No data platform is connected/);
  await assert.rejects(boards.describeData({ table: 'commercial.gold.missing' }, builder), /TABLE_DOES_NOT_EXIST/);
});

test('Sonic reaches the lookup through describe_board_data as the person who asked, and it is a read', async () => {
  const { platform } = fakePlatform();
  const boards = await service({ dataPlatform: platform });
  const toolsFor = roles => createAppTools({ taskStore: new FileTaskStore(path.join(tmp, `store-${roles[0]}`)), rbacStore: { overlay: base => ({ ...base, roles }), list: () => [] }, boards })({ id: 'T-1', projectId: 'pilot', createdBy: { id: 'priya', name: 'Priya Nair' } }, fakeMcpSdk).tools;
  const describe = toolsFor(['developer']).find(item => item.name === 'describe_board_data');
  assert.ok(describe, 'the tool is offered with the other board tools');
  const answer = JSON.parse((await describe.handler({ table: 'commercial.gold.veltrix_sales_daily' })).content[0].text);
  assert.equal(answer.table.columns.length, 4);
  const refused = await toolsFor(['viewer']).find(item => item.name === 'describe_board_data').handler({});
  assert.equal(refused.isError, true); assert.match(refused.content[0].text, /Viewers can open boards/);
  const { classifyTool } = await import('../src/tasks/permission-policy.mjs');
  assert.equal(classifyTool('mcp__nervecenter__describe_board_data', {}, { permission: 'ask' }).category, 'read', 'a lookup never waits for approval');
});

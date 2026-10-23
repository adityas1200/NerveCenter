import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { FileOperationsStore } from '../src/app/operations-store.mjs';
import { FileTaskStore } from '../src/tasks/task-store.mjs';
import { BoardService } from '../src/boards/board-service.mjs';
import { FixService, meets, snapshotChanges } from '../src/tasks/fix-service.mjs';
import { createAppTools } from '../src/tasks/nervecenter-tools.mjs';
import { createWorkspace, validateOperations } from '../src/workspace/workspace.mjs';
import { fakeMcpSdk, makeRuntime, sdkInit, sdkResult, tempDir, wait, pilot } from './helpers.mjs';

// SPEC-tasks-13: Sonic copies a table into the sandbox, fixes and tests the copy, proposes the fix; NerveCenter
// computes the diff and the board previews, applies only the stored statement, and verifies it.

const tmp = await tempDir('nc-tested-fixes-');
const TARGET = 'commercial.gold.veltrix_sales_daily';
const SANDBOX_SCHEMA = 'commercial_dev.sonic_sandbox';
const builder = { id: 'priya', name: 'Priya Nair', role: 'developer' };
const WIDGET_SQL = `SELECT payer_type, SUM(trx_count) AS trx FROM ${TARGET} GROUP BY payer_type ORDER BY payer_type`;
const CHECK = { label: 'No COMM payer types left', statement: `SELECT COUNT(*) AS bad_rows FROM ${TARGET} WHERE payer_type = 'COMM'`, expect: { op: 'eq', value: 0 } };
const FIX_SQL = (table) => `UPDATE ${table} SET payer_type = 'Commercial' WHERE payer_type = 'COMM'`;

/**
 * A warehouse that understands exactly the statements this feature sends, and refuses anything else, so the
 * tests also prove which SQL reaches the platform. Tables are lower-case full names with a Delta-like version.
 */
class Warehouse {
  constructor() { this.tables = new Map(); this.log = []; }
  add(name, columns, rows) { this.tables.set(name, { columns, rows: rows.map(row => ({ ...row })), version: 1 }); }
  table(name) { const found = this.tables.get(name.toLowerCase()); if (!found) throw new Error(`[TABLE_OR_VIEW_NOT_FOUND] The table or view \`${name}\` cannot be found.`); return found; }
  #except(a, b) { const seen = new Set(this.table(b).rows.map(row => JSON.stringify(this.table(b).columns.map(column => row[column])))); const out = []; const keys = new Set(); for (const row of this.table(a).rows) { const key = JSON.stringify(this.table(a).columns.map(column => row[column])); if (!seen.has(key) && !keys.has(key)) { keys.add(key); out.push(row); } } return out; }
  run(statement) {
    const sql = statement.trim(); this.log.push(sql); let m;
    const rowsOf = (table, rows) => ({ columns: table.columns, rows: rows.map(row => table.columns.map(column => row[column])) });
    if ((m = /^SELECT COUNT\(\*\) AS row_count FROM ([\w.]+)$/i.exec(sql))) return { columns: ['row_count'], rows: [[this.table(m[1]).rows.length]] };
    if ((m = /^SELECT COUNT\(\*\) AS row_count FROM \(SELECT \* FROM ([\w.]+) EXCEPT SELECT \* FROM ([\w.]+)\) AS fix_diff$/i.exec(sql))) return { columns: ['row_count'], rows: [[this.#except(m[1], m[2]).length]] };
    if ((m = /^SELECT \* FROM \(SELECT \* FROM ([\w.]+) EXCEPT SELECT \* FROM ([\w.]+)\) AS fix_diff LIMIT (\d+)$/i.exec(sql))) return rowsOf(this.table(m[1]), this.#except(m[1], m[2]).slice(0, Number(m[3])));
    if ((m = /^DESCRIBE HISTORY ([\w.]+) LIMIT 1$/i.exec(sql))) return { columns: ['version', 'operation'], rows: [[this.table(m[1]).version, 'WRITE']] };
    if ((m = /^CREATE TABLE ([\w.]+) (?:SHALLOW )?CLONE ([\w.]+)$/i.exec(sql))) { const source = this.table(m[2]); this.add(m[1], source.columns, source.rows); return { columns: [], rows: [] }; }
    if ((m = /^UPDATE ([\w.]+) SET (\w+) = '([^']*)' WHERE (\w+) = '([^']*)'$/i.exec(sql))) { const table = this.table(m[1]); let changed = 0; for (const row of table.rows) if (row[m[4]] === m[5]) { row[m[2]] = m[3]; changed += 1; } table.version += 1; return { columns: ['num_affected_rows'], rows: [[changed]] }; }
    if ((m = /^DROP TABLE IF EXISTS ([\w.]+)$/i.exec(sql))) { this.tables.delete(m[1].toLowerCase()); return { columns: [], rows: [] }; }
    if ((m = /^SELECT (\w+), SUM\((\w+)\) AS (\w+) FROM ([\w.]+) GROUP BY \1 ORDER BY \1$/i.exec(sql))) { const groups = new Map(); for (const row of this.table(m[4]).rows) groups.set(row[m[1]], (groups.get(row[m[1]]) || 0) + row[m[2]]); return { columns: [m[1], m[3]], rows: [...groups.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))) }; }
    if ((m = /^SELECT COUNT\(\*\) AS (\w+) FROM ([\w.]+) WHERE (\w+) = '([^']*)'$/i.exec(sql))) return { columns: [m[1]], rows: [[this.table(m[2]).rows.filter(row => row[m[3]] === m[4]).length]] };
    throw new Error(`The test warehouse cannot run: ${sql}`);
  }
  // The board service reads through queryRows (records) and writes through executeStatement (a statement payload).
  client() {
    return {
      queryRows: async ({ statement }) => { const { columns, rows } = this.run(statement); return rows.map(row => Object.fromEntries(columns.map((column, index) => [column, row[index]]))); },
      executeStatement: async ({ statement }) => { const { columns, rows } = this.run(statement); return { status: { state: 'SUCCEEDED' }, manifest: { schema: { columns: columns.map(name => ({ name })) } }, result: { data_array: rows } }; },
    };
  }
}

function sales() {
  const warehouse = new Warehouse();
  warehouse.add(TARGET, ['npi', 'payer_type', 'trx_count'], [
    { npi: '1001', payer_type: 'Commercial', trx_count: 5 }, { npi: '1002', payer_type: 'COMM', trx_count: 3 },
    { npi: '1003', payer_type: 'COMM', trx_count: 2 }, { npi: '1004', payer_type: 'Medicare', trx_count: 4 },
  ]);
  return warehouse;
}

let counter = 0;
async function setup({ sandbox = SANDBOX_SCHEMA } = {}) {
  const name = `case-${(counter += 1)}`;
  const warehouse = sales();
  const workspace = await createWorkspace({ dir: path.join(tmp, `ws-${name}`) });
  if (sandbox) await workspace.updateOperations(current => ({ ...current, fixes: { sandbox: { databricks: sandbox } } }));
  const store = new FileOperationsStore(path.join(tmp, `ops-${name}`)); await store.init();
  const taskStore = new FileTaskStore(path.join(tmp, `tasks-${name}`)); await taskStore.init();
  const boards = new BoardService({ store, taskStore, workspace, connectionService: { resolve: async () => ({ config: { warehouseId: 'wh-1' }, credentials: {} }) }, databricksFactory: () => warehouse.client() });
  const board = await boards.create({ title: 'Veltrix payer mix', widgets: [{ id: 'trx_by_payer', type: 'chart', title: 'TRx by payer type', source: { kind: 'sql', provider: 'databricks', statement: WIDGET_SQL }, viz: { chart: 'column', xColumn: 'payer_type', seriesColumns: ['trx'] } }] }, builder, pilot);
  await boards.setPublished(board.id, true, builder, pilot);
  const fixes = new FixService({ boards, workspace, taskStore });
  const taskId = `T-${name}`;
  await taskStore.createTask({ id: taskId, type: 'adhoc', title: 'Fix payer types', status: 'running', projectId: 'pilot', createdBy: { id: 'priya', name: 'Priya Nair' }, createdAt: new Date().toISOString() });
  const server = createAppTools({ operationsService: {}, taskStore, routines: null, rbacStore: { overlay: base => ({ ...base, roles: ['developer'] }), list: () => [] }, boards, fixes })({ id: taskId, projectId: 'pilot', createdBy: { id: 'priya', name: 'Priya Nair' } }, fakeMcpSdk);
  // The runtime stores each tool call and its result as task events; these tests do the same so lookups see them.
  const call = async (tool, args) => {
    const toolUseId = `tu-${Math.random().toString(36).slice(2, 10)}`;
    await taskStore.appendEvent(taskId, { type: 'tool.use', toolUseId, name: `mcp__nervecenter__${tool}`, input: JSON.stringify(args), parentToolUseId: null });
    const reply = await server.tools.find(item => item.name === tool).handler(args);
    await taskStore.appendEvent(taskId, { type: 'tool.result', toolUseId, isError: Boolean(reply.isError), content: reply.content[0].text, parentToolUseId: null });
    if (reply.isError) return { error: reply.content[0].text.replace(/^Error:\s*/, '') };
    return JSON.parse(reply.content[0].text);
  };
  return { warehouse, workspace, boards, board, fixes, taskStore, taskId, server, call };
}

async function proposeTested(ctx) {
  const copy = await ctx.call('create_fix_sandbox', { table: TARGET, reason: 'Test the payer type fix on a copy.' });
  await ctx.call('run_in_sandbox', { statement: FIX_SQL(copy.sandbox), purpose: 'Map COMM to Commercial on the copy', reason: 'Apply the fix to the copy only.' });
  const proposal = await ctx.call('propose_fix', { title: 'Map COMM payer type to Commercial', summary: 'COMM is the old code for Commercial.', target: TARGET, sandbox: copy.sandbox, apply: { statement: FIX_SQL(TARGET) }, tests: [{ name: 'No COMM rows on the copy', result: 'passed', command: 'SELECT COUNT(*) FROM copy' }, { name: 'Row count unchanged', result: 'passed' }], checks: [CHECK], key: ['npi'], files: [{ path: 'sql/fix.sql', diff: '+UPDATE …' }] });
  return { copy, proposal };
}

test('FR-1, FR-2: the sandbox is the schema operations.yaml names, and the copy goes there', async () => {
  const ctx = await setup();
  const copy = await ctx.call('create_fix_sandbox', { table: TARGET, reason: 'Test on a copy.' });
  assert.match(copy.sandbox, /^commercial_dev\.sonic_sandbox\.veltrix_sales_daily_fix_[0-9a-f]{6}$/);
  assert.equal(copy.source, TARGET);
  assert.deepEqual({ version: copy.snapshot.version, rowCount: copy.snapshot.rowCount }, { version: 1, rowCount: 4 });
  assert.ok(ctx.warehouse.log.includes(`CREATE TABLE ${copy.sandbox} SHALLOW CLONE ${TARGET}`));
  const again = await ctx.call('create_fix_sandbox', { table: copy.sandbox, reason: 'Copy the copy.' });
  assert.match(again.error, /already in the sandbox schema/);

  const none = await setup({ sandbox: null });
  const refused = await none.call('create_fix_sandbox', { table: TARGET, reason: 'Test on a copy.' });
  assert.equal(refused.error, 'No fix sandbox is set for databricks. Add fixes.sandbox.databricks to operations.yaml.');
  assert.equal(none.warehouse.log.length, 0, 'nothing ran');
});

test('FR-3, FR-4: run_in_sandbox changes only the copy; writes elsewhere are refused before anything runs', async () => {
  const ctx = await setup();
  const copy = await ctx.call('create_fix_sandbox', { table: TARGET, reason: 'Copy.' });
  const changed = await ctx.call('run_in_sandbox', { statement: FIX_SQL(copy.sandbox), purpose: 'Fix the copy', reason: 'Copy only.' });
  assert.deepEqual([changed.kind, changed.verb, changed.target, changed.rows[0][0]], ['write', 'update', copy.sandbox, 2]);
  const read = await ctx.call('run_in_sandbox', { statement: `SELECT COUNT(*) AS bad_rows FROM ${copy.sandbox} WHERE payer_type = 'COMM'`, purpose: 'Check', reason: 'Check the copy.' });
  assert.deepEqual(read.rows, [[0]]);
  const before = ctx.warehouse.log.length;
  for (const statement of [FIX_SQL(TARGET), `DELETE FROM ${TARGET} WHERE npi = '1001'`, `UPDATE ${copy.sandbox} SET a = 1; DROP TABLE ${TARGET}`, `GRANT SELECT ON TABLE ${copy.sandbox} TO someone`]) {
    const refused = await ctx.call('run_in_sandbox', { statement, purpose: 'Try', reason: 'Try.' });
    assert.ok(refused.error, statement);
  }
  assert.equal(ctx.warehouse.log.length, before, 'no refused statement reached the warehouse');
  assert.equal(ctx.warehouse.table(TARGET).rows.filter(row => row.payer_type === 'COMM').length, 2, 'the original is untouched');
  assert.match((await ctx.call('drop_fix_sandbox', { sandbox: TARGET, reason: 'Drop.' })).error, /not in the sandbox schema/);
  assert.deepEqual(await ctx.call('drop_fix_sandbox', { sandbox: copy.sandbox, reason: 'Done.' }), { dropped: copy.sandbox });
  assert.equal(ctx.warehouse.tables.has(copy.sandbox), false);
});

test('FR-5 to FR-8: the proposal holds the diff, the predicted checks and the board widget now and after the fix', async () => {
  const ctx = await setup();
  const { copy, proposal } = await proposeTested(ctx);
  assert.match(proposal.proposalId, /^FP-[0-9a-f]{8}$/);
  assert.equal(proposal.state, 'proposed');
  assert.deepEqual([proposal.target, proposal.sandbox, proposal.testsPassed, proposal.testsTotal], [TARGET, copy.sandbox, 2, 2]);
  assert.equal(proposal.summary, 'COMM is the old code for Commercial.');
  assert.deepEqual(proposal.tests, [{ name: 'No COMM rows on the copy', result: 'passed', command: 'SELECT COUNT(*) FROM copy' }, { name: 'Row count unchanged', result: 'passed' }]);
  assert.deepEqual(proposal.files, [{ path: 'sql/fix.sql', diff: '+UPDATE …' }]);
  assert.deepEqual({ ...proposal.diff, before: undefined, after: undefined }, { rowsBefore: 4, rowsAfter: 4, onlyBefore: 2, onlyAfter: 2, key: ['npi'], changedColumns: ['payer_type'], before: undefined, after: undefined });
  assert.deepEqual(proposal.diff.before.rows, [['1002', 'COMM', 3], ['1003', 'COMM', 2]]);
  assert.deepEqual(proposal.diff.after.rows, [['1002', 'Commercial', 3], ['1003', 'Commercial', 2]]);
  assert.deepEqual(proposal.checks.map(check => [check.label, check.expected, check.predicted]), [['No COMM payer types left', 0, 'pass']]);
  assert.equal(proposal.previews.length, 1);
  const [preview] = proposal.previews;
  assert.deepEqual([preview.boardId, preview.widgetId, preview.title], [ctx.board.id, 'trx_by_payer', 'TRx by payer type']);
  assert.deepEqual(preview.now.rows, [['COMM', 5], ['Commercial', 5], ['Medicare', 4]]);
  assert.deepEqual(preview.after.rows, [['Commercial', 10], ['Medicare', 4]]);
  assert.ok(ctx.warehouse.log.includes(WIDGET_SQL.replace(TARGET, copy.sandbox)), 'the widget ran on the copy');
  assert.equal(proposal.apply.statement, FIX_SQL(TARGET));
  assert.ok(!ctx.warehouse.log.some(sql => /^UPDATE commercial\.gold/i.test(sql)), 'proposing changes nothing');
  assert.ok(JSON.stringify(proposal, null, 1).length < 18000);
});

test('FR-5: a proposal must change the target with one allowed statement and test on a copy in the sandbox', async () => {
  const ctx = await setup();
  const copy = await ctx.call('create_fix_sandbox', { table: TARGET, reason: 'Copy.' });
  const base = { title: 'Fix', target: TARGET, sandbox: copy.sandbox, tests: [{ name: 'Tested', result: 'passed' }] };
  assert.match((await ctx.call('propose_fix', { ...base, apply: { statement: FIX_SQL('commercial.gold.other_table') } })).error, /writes commercial\.gold\.other_table, not/);
  assert.match((await ctx.call('propose_fix', { ...base, apply: { statement: `DROP TABLE ${TARGET}` } })).error, /must be one INSERT, UPDATE/);
  assert.match((await ctx.call('propose_fix', { ...base, apply: { statement: `GRANT ALL ON ${TARGET} TO x` } })).error, /Access changes/);
  assert.match((await ctx.call('propose_fix', { ...base, sandbox: 'commercial.gold.copy', apply: { statement: FIX_SQL(TARGET) } })).error, /not in the sandbox schema/);
  assert.match((await ctx.call('propose_fix', { ...base, apply: { statement: FIX_SQL(TARGET) }, checks: [{ ...CHECK, statement: `SELECT COUNT(*) AS n FROM commercial.gold.elsewhere WHERE a = 'b'` }] })).error, /must be a SELECT that reads/);
});

test('FR-12 at proposal time: a copy made before the table changed is not proposed', async () => {
  const ctx = await setup();
  const copy = await ctx.call('create_fix_sandbox', { table: TARGET, reason: 'Copy.' });
  ctx.warehouse.run(`UPDATE ${TARGET} SET trx_count = '9' WHERE npi = '1004'`);
  const refused = await ctx.call('propose_fix', { title: 'Fix', target: TARGET, sandbox: copy.sandbox, apply: { statement: FIX_SQL(TARGET) }, tests: [{ name: 'Tested', result: 'passed' }] });
  assert.match(refused.error, /changed after the sandbox copy was made \(version 1 → 2\)/);
});

test('FR-10 to FR-18: apply runs the stored statement once, verifies, drops the copy and marks the board widget', async () => {
  const ctx = await setup();
  const { copy, proposal } = await proposeTested(ctx);
  const result = await ctx.call('apply_fix', { proposalId: proposal.proposalId, reason: 'The fix tested clean on the copy.' });
  assert.equal(ctx.warehouse.log.filter(sql => sql === FIX_SQL(TARGET)).length, 1, 'the statement ran once, on the target');
  assert.equal(result.applied, true);
  assert.equal(result.verification.status, 'passed');
  assert.deepEqual(result.verification.checks.map(check => [check.label, check.expected, check.actual, check.result]), [['No COMM payer types left', 0, 0, 'pass']]);
  assert.deepEqual(result.verification.rowCount, { before: 4, after: 4 });
  assert.deepEqual(result.verification.previews.map(preview => [preview.widgetId, preview.matches]), [['trx_by_payer', true]]);
  assert.deepEqual(result.verification.previews[0].actual.rows, [['Commercial', 10], ['Medicare', 4]]);
  assert.equal(result.sandboxDropped, true);
  assert.equal(ctx.warehouse.tables.has(copy.sandbox), false, 'FR-15: a passed fix drops the copy');

  const task = await ctx.taskStore.getTask(ctx.taskId);
  assert.deepEqual(task.fixes.map(fix => [fix.proposalId, fix.status, fix.target]), [[proposal.proposalId, 'passed', TARGET]]);
  assert.deepEqual(task.fixes[0].widgets, [{ boardId: ctx.board.id, widgetId: 'trx_by_payer' }]);
  const data = await ctx.boards.run(ctx.board.id, {}, builder, pilot);
  assert.deepEqual(data.fixes.trx_by_payer && { taskId: data.fixes.trx_by_payer.taskId, status: data.fixes.trx_by_payer.status, proposalId: data.fixes.trx_by_payer.proposalId }, { taskId: ctx.taskId, status: 'passed', proposalId: proposal.proposalId });

  assert.equal((await ctx.call('apply_fix', { proposalId: proposal.proposalId, reason: 'Again.' })).error, `Fix ${proposal.proposalId} was already applied`);
  assert.equal((await ctx.call('apply_fix', { proposalId: 'FP-00000000', reason: 'Unknown.' })).error, 'No fix proposal FP-00000000 in this task');
});

test('FR-12: a table that changed since the test blocks the apply and nothing runs on it', async () => {
  const ctx = await setup();
  const { proposal } = await proposeTested(ctx);
  ctx.warehouse.run(`UPDATE ${TARGET} SET trx_count = '9' WHERE npi = '1004'`);
  const before = ctx.warehouse.log.length;
  const refused = await ctx.call('apply_fix', { proposalId: proposal.proposalId, reason: 'Apply.' });
  assert.equal(refused.error, `${TARGET} changed since the fix was tested (version 1 → 2). Clone it again, test again and propose the fix again.`);
  assert.ok(!ctx.warehouse.log.slice(before).includes(FIX_SQL(TARGET)), 'the apply statement never ran');
  assert.equal((await ctx.taskStore.getTask(ctx.taskId)).fixes, undefined);
});

test('FR-14, FR-15: a check that fails after the apply keeps the copy and records a failed fix', async () => {
  const ctx = await setup();
  const copy = await ctx.call('create_fix_sandbox', { table: TARGET, reason: 'Copy.' });
  await ctx.call('run_in_sandbox', { statement: FIX_SQL(copy.sandbox), purpose: 'Fix', reason: 'Copy.' });
  // The apply statement does not match what was tested on the copy, so the real table ends up different.
  const proposal = await ctx.call('propose_fix', { title: 'Wrong fix', target: TARGET, sandbox: copy.sandbox, apply: { statement: `UPDATE ${TARGET} SET payer_type = 'Medicare' WHERE payer_type = 'Commercial'` }, tests: [{ name: 'Tested', result: 'passed' }], checks: [CHECK] });
  const result = await ctx.call('apply_fix', { proposalId: proposal.proposalId, reason: 'Apply.' });
  assert.equal(result.verification.status, 'failed');
  assert.deepEqual(result.verification.checks.map(check => [check.expected, check.actual, check.result]), [[0, 2, 'fail']]);
  assert.equal(result.verification.previews[0].matches, false);
  assert.equal(result.sandboxDropped, false);
  assert.ok(ctx.warehouse.tables.has(copy.sandbox), 'the copy is kept to investigate');
  assert.match(result.note, /is kept/);
  assert.equal((await ctx.taskStore.getTask(ctx.taskId)).fixes[0].status, 'failed');
});

test('FR-11: the approval for apply_fix names the target and carries what NerveCenter stored', async () => {
  const proposal = { proposalId: 'FP-1a2b3c4d', state: 'proposed', provider: 'databricks', title: 'Map COMM payer type to Commercial', target: TARGET, sandbox: `${SANDBOX_SCHEMA}.veltrix_sales_daily_fix_abc123`, snapshot: { version: 1, lastAlteredAt: null, rowCount: 4, takenAt: '2026-10-13T10:00:00.000Z' }, diff: {}, checks: [], previews: [], testsPassed: 3, testsTotal: 3, apply: { statement: FIX_SQL(TARGET) } };
  const decisions = [];
  const sdk = {
    query({ options }) {
      return (async function* () {
        yield sdkInit('sess-fix');
        yield { type: 'assistant', session_id: 'sess-fix', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'tu-propose', name: 'mcp__nervecenter__propose_fix', input: { title: proposal.title } }] } };
        yield { type: 'user', session_id: 'sess-fix', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 'tu-propose', content: [{ type: 'text', text: JSON.stringify(proposal, null, 1) }] }] } };
        decisions.push(await options.canUseTool('mcp__nervecenter__apply_fix', { proposalId: 'FP-ffffffff', reason: 'Apply the tested fix.' }, { signal: options.abortController.signal }));
        decisions.push(await options.canUseTool('mcp__nervecenter__apply_fix', { proposalId: proposal.proposalId, reason: 'Apply the tested fix.' }, { signal: options.abortController.signal }));
        yield sdkResult('sess-fix', 'Applied.');
      })();
    },
  };
  const { store, runtime } = await makeRuntime(tmp, sdk, { name: 'gate' });
  const task = await runtime.startTask({ scope: pilot, prompt: 'Fix the payer types', user: { id: 'priya', name: 'Priya Nair', role: 'developer' }, notify: false });
  await wait(async () => (await store.getTask(task.id)).status === 'waiting', 10000, 'approval');
  assert.equal(decisions[0].behavior, 'deny');
  assert.match(decisions[0].message, /No fix proposal FP-ffffffff in this task/);
  const [item] = await store.listInbox(pilot, { status: 'pending', kind: 'approval' });
  assert.equal(item.title, `Apply tested fix to ${TARGET}`);
  assert.equal(item.category, 'production_changes');
  assert.deepEqual(item.fix, { proposalId: proposal.proposalId, title: proposal.title, target: TARGET, sandbox: proposal.sandbox, testsPassed: 3, testsTotal: 3, statement: FIX_SQL(TARGET) });
  const requested = (await store.listEvents(task.id)).find(event => event.type === 'approval.requested');
  assert.equal(requested.title, `Waiting for approval: Apply tested fix to ${TARGET}`);
  assert.equal(requested.fix.proposalId, proposal.proposalId);
  await runtime.decideApproval(item.id, 'approved', { id: 'priya', name: 'Priya Nair', role: 'developer' });
  await wait(async () => (await store.getTask(task.id)).status === 'done', 10000, 'done');
  assert.equal(decisions[1].behavior, 'allow');
});

test('FR-19: the prompt routes data fixes through the tested-fix tools when NerveCenter tools are on', async () => {
  const calls = [];
  const sdk = { createSdkMcpServer: () => ({}), query({ prompt, options }) { calls.push({ prompt, options }); return (async function* () { yield sdkInit('sess-p'); yield sdkResult('sess-p', 'Hi.'); })(); } };
  const { store, runtime } = await makeRuntime(tmp, sdk, { name: 'prompt', appTools: async () => ({}) });
  const task = await runtime.startTask({ scope: pilot, prompt: 'Hello', user: { id: 'priya', name: 'Priya Nair' }, notify: false });
  await wait(async () => (await store.getTask(task.id)).status === 'done', 10000, 'done');
  const append = calls[0].options.systemPrompt.append;
  assert.match(append, /create_fix_sandbox to copy the table, run_in_sandbox to make the change on the copy and test it there, propose_fix/);
  assert.match(append, /Do not apply a data fix with raw SQL through Bash/);
  assert.match(append, /Do not resolve a ticket on a failed or inconclusive verification/);
});

test('helpers: expectations and snapshot changes', () => {
  assert.equal(meets(0, { op: 'eq', value: 0 }), true);
  assert.equal(meets('0', { op: 'eq', value: 0 }), true, 'Databricks returns numbers as text');
  assert.equal(meets(3, { op: 'lte', value: '2' }), false);
  assert.equal(meets('Commercial', { op: 'eq', value: 'Commercial' }), true);
  assert.equal(meets('a', { op: 'gt', value: 'b' }), false, 'only numbers order');
  assert.deepEqual(snapshotChanges({ version: 3, lastAlteredAt: null, rowCount: 10 }, { version: 3, lastAlteredAt: '2026-10-13', rowCount: 10 }), [], 'a field known on one side only is not a change');
  assert.deepEqual(snapshotChanges({ version: 3, lastAlteredAt: 'a', rowCount: 10 }, { version: 4, lastAlteredAt: 'b', rowCount: 11 }), ['version 3 → 4', 'last changed b', 'rows 10 → 11']);
});

test('FR-1: operations.yaml validation names a bad fixes.sandbox', () => {
  const base = { team: { name: 'Ops', timezone: 'UTC' } };
  assert.deepEqual(validateOperations({ ...base, fixes: { sandbox: { databricks: 'commercial_dev.sonic_sandbox' } } }).errors, []);
  assert.deepEqual(validateOperations({ ...base, fixes: { sandbox: { databricks: 'commercial_dev' } } }).errors, ['fixes.sandbox.databricks must be catalog.schema (database.schema on Snowflake)']);
  assert.deepEqual(validateOperations({ ...base, fixes: { sandbox: { oracle: 'a.b' } } }).errors, ['fixes.sandbox.oracle is not a platform; use databricks or snowflake']);
  assert.equal(validateOperations({ ...base, fixes: { sandbox: { snowflake: 'ANALYTICS.SONIC' } } }).warnings.some(item => /unrecognized/.test(item)), false);
});

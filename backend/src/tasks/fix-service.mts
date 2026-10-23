import { randomBytes } from 'node:crypto';
import { httpError, now } from '../lib/util.mjs';
import { asRegistry } from '../workspace/workspace.mjs';
import { forProject } from '../projects/project-bound.mjs';
import { plainError } from '../boards/board-service.mjs';
import { fullName, inSchema, mentions, shapeOf, swapTable, type SqlProvider } from './sql-scope.mjs';

/**
 * Tested fixes (SPEC-tasks-13, ADR 0020). Sonic copies a table into the sandbox schema, changes and tests the
 * copy there, then proposes the fix; NerveCenter computes what will change (the table diff, the checks, the
 * person's own board widgets on the copy) and keeps it as the tool result. Applying takes only the proposal id:
 * the statement, target and snapshot come from that stored result, the table must not have changed since, and
 * the same checks and widgets are re-run on the real table afterwards.
 */

type Dict = Record<string, unknown>;
type Scope = { projectId: string; [key: string]: unknown };
type FixUser = { id?: string; name?: string; role?: string; [key: string]: unknown };
type FixTask = { id: string; projectId?: string; fixes?: FixRecord[] };
type Cell = string | number | null;
type Rows = { columns: string[]; rows: Cell[][] };
type Snapshot = { version: number | null; lastAlteredAt: string | null; rowCount: number | null; takenAt: string };
type Expect = { op: 'eq'|'ne'|'gt'|'gte'|'lt'|'lte'; value: string | number };
type CheckInput = { label: string; statement: string; expect: Expect };
type Preview = { boardId: string; boardTitle: string; widgetId: string; title: string; type: string; viz?: unknown; now: Rows | { error: string }; after: Rows | { error: string } };
type FixRecord = { proposalId: string; title: string; target: string; status: string; appliedAt: string; widgets: Array<{ boardId: string; widgetId: string }> };
type TestRun = { name: string; result: 'passed'|'failed'|'skipped'; command?: string; detail?: string };
type FileDiff = { path: string; diff: string; language?: string };
export type Proposal = { proposalId: string; state: 'proposed'; provider: SqlProvider; title: string; summary: string | null; target: string; sandbox: string; snapshot: Snapshot; diff: Dict; checks: Array<CheckInput & { expected: Cell; predicted: 'pass'|'fail'|'error'; error?: string }>; previews: Preview[]; tests: TestRun[]; testsPassed: number; testsTotal: number; apply: { statement: string }; files?: FileDiff[] };
type BoardLike = { id: string; title: string; filters: unknown[]; widgets: Array<{ id: string; title: string; type: string; viz?: unknown; source: { kind: string; statement?: string; provider?: SqlProvider } }> };
type Boards = {
  sql(args: { provider: SqlProvider; statement: string; scope: Scope; write?: boolean; rowLimit?: number }): Promise<{ columns: string[]; rows: unknown[][] }>;
  sqlWidgetsReading(reads: (statement: string, provider: SqlProvider) => boolean, user: FixUser, scope: Scope, limit?: number): Promise<Array<{ board: BoardLike; widget: BoardLike['widgets'][number] }>>;
  runAtDefaults(board: BoardLike, widget: BoardLike['widgets'][number], user: FixUser, scope: Scope, statement?: string): Promise<{ columns?: string[]; rows?: unknown[][]; error?: string }>;
  get(id: string, user: FixUser, scope: Scope): Promise<BoardLike>;
};
type TaskEvents = { listEvents(id: string, filters?: { limit?: number }): Promise<StoredEvent[]>; getTask(id: string): Promise<FixTask | null>; updateTask(id: string, patch: Dict): Promise<unknown> };
type Platform = { getTable(args: Dict): Promise<{ lastAlteredAt?: string | null; rowCount?: number | null }> };
type Ctx = { task: FixTask; user: FixUser; scope: Scope };

const APPLY_VERBS = new Set(['insert into', 'insert overwrite', 'update', 'delete from', 'merge into', 'create or replace table', 'create or replace view', 'alter table']);
const SAMPLE_ROWS = 6; const SAMPLE_COLUMNS = 10; const PREVIEW_ROWS = 12; const PREVIEW_COLUMNS = 8; const CELL = 80;
// The stored tool result is cut at 20,000 characters (task-runtime MAX_EVENT_TEXT) and is pretty-printed with one space.
const RESULT_BUDGET = 18_000;
const shortId = (bytes: number) => randomBytes(bytes).toString('hex').slice(0, bytes * 2);

const cut = (value: unknown): Cell => { if (value === null || value === undefined) return null; if (typeof value === 'number') return value; const text = typeof value === 'string' ? value : JSON.stringify(value); return text.length > CELL ? `${text.slice(0, CELL - 1)}…` : text; };
const trimRows = (result: { columns?: string[]; rows?: unknown[][] }, rows: number, columns: number): Rows => ({ columns: (result.columns || []).slice(0, columns), rows: (result.rows || []).slice(0, rows).map(row => row.slice(0, columns).map(cut)) });
const firstCell = (result: { rows: unknown[][] }): Cell => cut(result.rows?.[0]?.[0] ?? null);
const asNumber = (value: unknown) => { const number = typeof value === 'number' ? value : Number(String(value ?? '').trim()); return String(value ?? '').trim() !== '' && Number.isFinite(number) ? number : null; };

/** Whether a check's value meets its expectation; numbers compare as numbers, anything else only by eq or ne. */
export function meets(value: Cell, expect: Expect): boolean {
  const left = asNumber(value); const right = asNumber(expect.value);
  if (left !== null && right !== null) return { eq: left === right, ne: left !== right, gt: left > right, gte: left >= right, lt: left < right, lte: left <= right }[expect.op];
  if (expect.op === 'eq') return String(value ?? '') === String(expect.value);
  if (expect.op === 'ne') return String(value ?? '') !== String(expect.value);
  return false;
}

/** What differs between two snapshots, in words; empty when nothing known on both sides moved. */
export function snapshotChanges(before: Snapshot, after: Snapshot): string[] {
  const out = [];
  if (before.version !== null && after.version !== null && before.version !== after.version) out.push(`version ${before.version} → ${after.version}`);
  if (before.lastAlteredAt && after.lastAlteredAt && before.lastAlteredAt !== after.lastAlteredAt) out.push(`last changed ${after.lastAlteredAt}`);
  if (before.rowCount !== null && after.rowCount !== null && before.rowCount !== after.rowCount) out.push(`rows ${before.rowCount} → ${after.rowCount}`);
  return out;
}

const sameRows = (a: Rows, b: Rows) => JSON.stringify(a.columns.map(c => c.toLowerCase())) === JSON.stringify(b.columns.map(c => c.toLowerCase())) && JSON.stringify(a.rows.map(row => row.map(cell => (cell === null ? null : String(cell))))) === JSON.stringify(b.rows.map(row => row.map(cell => (cell === null ? null : String(cell)))));

export class FixService {
  declare boards: Boards; declare workspace: unknown; declare dataPlatform: unknown; declare taskStore: TaskEvents;
  constructor({ boards, workspace, dataPlatform, taskStore }: { boards: Boards; workspace: unknown; dataPlatform?: unknown; taskStore: TaskEvents }) {
    Object.assign(this, { boards, workspace, dataPlatform, taskStore });
  }

  /** `fixes.sandbox` from the project's operations.yaml (FR-1). */
  async #sandboxes(scope: Scope): Promise<Partial<Record<SqlProvider, string>>> {
    const registry = asRegistry(this.workspace) as { for(scope: Scope): Promise<{ getSection(name: string): Promise<unknown> }> } | null;
    if (!registry) return {};
    const section = await (await registry.for(scope)).getSection('fixes') as { sandbox?: Partial<Record<SqlProvider, unknown>> } | null;
    const out: Partial<Record<SqlProvider, string>> = {};
    for (const provider of ['databricks', 'snowflake'] as const) { const value = section?.sandbox?.[provider]; if (value) out[provider] = fullName(value, `fixes.sandbox.${provider} schema`, 2); }
    return out;
  }
  async #target(provider: SqlProvider | undefined, scope: Scope): Promise<{ provider: SqlProvider; schema: string }> {
    const sandboxes = await this.#sandboxes(scope);
    const picked = provider || (sandboxes.databricks ? 'databricks' : sandboxes.snowflake ? 'snowflake' : 'databricks');
    const schema = sandboxes[picked];
    if (!schema) throw httpError(400, `No fix sandbox is set for ${picked}. Add fixes.sandbox.${picked} to operations.yaml.`);
    return { provider: picked, schema };
  }
  #sql(provider: SqlProvider, statement: string, scope: Scope, write = false, rowLimit = 50) { return this.boards.sql({ provider, statement, scope, write, rowLimit }); }

  /** FR-9. A platform that cannot give a field leaves it null rather than failing the fix. */
  async snapshot(provider: SqlProvider, table: string, scope: Scope): Promise<Snapshot> {
    const count = asNumber(firstCell(await this.#sql(provider, `SELECT COUNT(*) AS row_count FROM ${table}`, scope)));
    let version: number | null = null; let lastAlteredAt: string | null = null;
    if (provider === 'databricks') {
      // DESCRIBE HISTORY works on Delta tables only; a view or another format has no version to compare.
      try { const history = await this.#sql(provider, `DESCRIBE HISTORY ${table} LIMIT 1`, scope, true, 1); const at = history.columns.findIndex(column => column.toLowerCase() === 'version'); version = at >= 0 ? asNumber(history.rows[0]?.[at]) : null; } catch { version = null; }
    } else if (this.dataPlatform) {
      // Table metadata is optional evidence: without it the row count still guards the apply.
      try { const platform = await forProject(this.dataPlatform, scope) as Platform; lastAlteredAt = (await platform.getTable({ provider, objectId: table })).lastAlteredAt || null; } catch { lastAlteredAt = null; }
    }
    return { version, lastAlteredAt, rowCount: count, takenAt: now() };
  }

  /* ------------------------------------------------------------- sandbox */

  async createSandbox({ provider: asked, table }: { provider?: SqlProvider; table: string }, { scope }: Ctx) {
    const { provider, schema } = await this.#target(asked, scope);
    const source = fullName(table);
    if (inSchema(source, schema)) throw httpError(400, `${source} is already in the sandbox schema ${schema}; copy the original table instead`);
    const snapshot = await this.snapshot(provider, source, scope);
    const sandbox = `${schema}.${source.split('.')[2].slice(0, 80)}_fix_${shortId(3)}`;
    await this.#sql(provider, provider === 'databricks' ? `CREATE TABLE ${sandbox} SHALLOW CLONE ${source}` : `CREATE TABLE ${sandbox} CLONE ${source}`, scope, true);
    return { provider, source, sandbox, snapshot, next: 'Change and test the copy with run_in_sandbox, then call propose_fix with the target, the sandbox and the exact statement to run on the target.' };
  }

  async runInSandbox({ provider: asked, statement }: { provider?: SqlProvider; statement: string }, { scope }: Ctx) {
    const { provider, schema } = await this.#target(asked, scope);
    let shape;
    try { shape = shapeOf(statement, provider); } catch (error) { throw httpError(400, (error as Error).message); }
    if (shape.kind === 'select') { const result = await this.#sql(provider, statement, scope); return { kind: 'select', ...trimRows(result, 50, 30), rowCount: result.rows.length }; }
    for (const name of [shape.target, ...shape.others]) if (!inSchema(name, schema)) throw httpError(400, `${shape.verb.toUpperCase()} on ${name} is outside the sandbox schema ${schema}; run_in_sandbox only changes copies there`);
    const result = await this.#sql(provider, statement, scope, true, 5);
    return { kind: 'write', verb: shape.verb, target: shape.target, ...trimRows(result, 5, 10) };
  }

  async dropSandbox({ provider: asked, sandbox }: { provider?: SqlProvider; sandbox: string }, { scope }: Ctx) {
    const { provider, schema } = await this.#target(asked, scope);
    const name = fullName(sandbox, 'sandbox table');
    if (!inSchema(name, schema)) throw httpError(400, `${name} is not in the sandbox schema ${schema}`);
    await this.#sql(provider, `DROP TABLE IF EXISTS ${name}`, scope, true);
    return { dropped: name };
  }

  /* ------------------------------------------------------------ proposal */

  async #stored(taskId: string, tool: string, match: (data: Dict) => boolean): Promise<Dict | null> { return storedResult(await this.taskStore.listEvents(taskId, { limit: 10_000 }), tool, match); }

  async propose(input: { provider?: SqlProvider; title: string; summary?: string; target: string; sandbox: string; apply: { statement: string }; tests: TestRun[]; checks?: CheckInput[]; key?: string[]; files?: FileDiff[] }, { task, user, scope }: Ctx): Promise<Proposal> {
    const { provider, schema } = await this.#target(input.provider, scope);
    const target = fullName(input.target, 'target table'); const sandbox = fullName(input.sandbox, 'sandbox table');
    if (!inSchema(sandbox, schema)) throw httpError(400, `The sandbox ${sandbox} is not in the sandbox schema ${schema}; copy the table with create_fix_sandbox first`);
    if (inSchema(target, schema)) throw httpError(400, `The target ${target} is in the sandbox schema; give the original table`);
    let shape;
    try { shape = shapeOf(input.apply.statement, provider); } catch (error) { throw httpError(400, `The apply statement: ${(error as Error).message}`); }
    if (shape.kind !== 'write' || !APPLY_VERBS.has(shape.verb)) throw httpError(400, 'The apply statement must be one INSERT, UPDATE, DELETE, MERGE, CREATE OR REPLACE TABLE or VIEW, or ALTER TABLE statement');
    if (shape.target !== target || shape.others.length) throw httpError(400, `The apply statement writes ${shape.target}, not ${target}`);
    const key = (input.key || []).map(column => { if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(column)) throw httpError(400, `Key column "${column}" is not a plain column name`); return column.toLowerCase(); });
    const checks = input.checks || [];
    for (const check of checks) {
      let checkShape; try { checkShape = shapeOf(check.statement, provider); } catch (error) { throw httpError(400, `Check "${check.label}": ${(error as Error).message}`); }
      if (checkShape.kind !== 'select' || !mentions(check.statement, target, provider)) throw httpError(400, `Check "${check.label}" must be a SELECT that reads ${target}`);
    }
    const snapshot = await this.snapshot(provider, target, scope);
    // FR-12 at proposal time: a copy made before the table moved is not a test of the table as it is now.
    const made = await this.#stored(task.id, 'create_fix_sandbox', data => data.sandbox === sandbox);
    if (made?.snapshot) { const moved = snapshotChanges(made.snapshot as Snapshot, snapshot); if (moved.length) throw httpError(409, `${target} changed after the sandbox copy was made (${moved.join(', ')}). Make a new copy, test again and propose the fix again.`); }

    const count = async (statement: string) => asNumber(firstCell(await this.#sql(provider, statement, scope)));
    const minus = (a: string, b: string) => `SELECT * FROM ${a} EXCEPT SELECT * FROM ${b}`;
    const [rowsBefore, rowsAfter, onlyBefore, onlyAfter, samplesBefore, samplesAfter] = await Promise.all([
      count(`SELECT COUNT(*) AS row_count FROM ${target}`), count(`SELECT COUNT(*) AS row_count FROM ${sandbox}`),
      count(`SELECT COUNT(*) AS row_count FROM (${minus(target, sandbox)}) AS fix_diff`), count(`SELECT COUNT(*) AS row_count FROM (${minus(sandbox, target)}) AS fix_diff`),
      this.#sql(provider, `SELECT * FROM (${minus(target, sandbox)}) AS fix_diff LIMIT ${SAMPLE_ROWS}`, scope), this.#sql(provider, `SELECT * FROM (${minus(sandbox, target)}) AS fix_diff LIMIT ${SAMPLE_ROWS}`, scope),
    ]);
    const before = trimRows(samplesBefore, SAMPLE_ROWS, SAMPLE_COLUMNS); const after = trimRows(samplesAfter, SAMPLE_ROWS, SAMPLE_COLUMNS);
    const diff: Dict = { rowsBefore, rowsAfter, onlyBefore, onlyAfter, before, after, ...(key.length ? { key, changedColumns: changedColumns(samplesBefore, samplesAfter, key) } : {}) };

    const predicted = await Promise.all(checks.map(async check => {
      try { const expected = firstCell(await this.#sql(provider, swapTable(check.statement, target, sandbox, provider).sql, scope)); return { ...check, expected, predicted: meets(expected, check.expect) ? 'pass' as const : 'fail' as const }; }
      catch (error) { return { ...check, expected: null, predicted: 'error' as const, error: plainError(error) }; }
    }));
    const reading = await this.boards.sqlWidgetsReading((statement, widgetProvider) => widgetProvider === provider && mentions(statement, target, provider), user, scope, 3);
    const previews: Preview[] = await Promise.all(reading.map(async ({ board, widget }) => {
      const run = async (statement?: string) => { try { const result = await this.boards.runAtDefaults(board, widget, user, scope, statement); return result.error ? { error: result.error } : trimRows(result, PREVIEW_ROWS, PREVIEW_COLUMNS); } catch (error) { return { error: plainError(error) }; } };
      return { boardId: board.id, boardTitle: board.title, widgetId: widget.id, title: widget.title, type: widget.type, viz: widget.viz, now: await run(), after: await run(swapTable(String(widget.source.statement), target, sandbox, provider).sql) };
    }));
    const tests = input.tests.map(test => ({ name: test.name, result: test.result, ...(test.command ? { command: test.command.slice(0, 300) } : {}), ...(test.detail ? { detail: test.detail } : {}) }));
    const proposal: Proposal = { proposalId: `FP-${shortId(4)}`, state: 'proposed', provider, title: input.title, summary: input.summary || null, target, sandbox, snapshot, diff, checks: predicted, previews, tests, testsPassed: tests.filter(test => test.result === 'passed').length, testsTotal: tests.length, apply: { statement: input.apply.statement.trim().replace(/;\s*$/, '') }, ...(input.files?.length ? { files: input.files } : {}) };
    return fitBudget(proposal);
  }

  /* --------------------------------------------------------------- apply */

  /** The proposal as NerveCenter stored it in this task (FR-10), for the gate's approval card and for apply. */
  async proposalOf(taskId: string, proposalId: string): Promise<Proposal | null> { return storedProposal(await this.taskStore.listEvents(taskId, { limit: 10_000 }), proposalId); }

  async apply({ proposalId }: { proposalId: string }, { task, user, scope }: Ctx) {
    const proposal = await this.proposalOf(task.id, proposalId);
    if (!proposal) throw httpError(404, `No fix proposal ${proposalId} in this task`);
    const record = await this.taskStore.getTask(task.id);
    if ((record?.fixes || []).some(fix => fix.proposalId === proposalId)) throw httpError(409, `Fix ${proposalId} was already applied`);
    const { provider, target, sandbox } = proposal;
    const current = await this.snapshot(provider, target, scope);
    const moved = snapshotChanges(proposal.snapshot, current);
    if (moved.length) throw httpError(409, `${target} changed since the fix was tested (${moved.join(', ')}). Clone it again, test again and propose the fix again.`);
    await this.#sql(provider, proposal.apply.statement, scope, true);
    const appliedAt = now();

    // FR-14: the same checks and widgets, now on the real table.
    const checks = await Promise.all(proposal.checks.map(async check => {
      try { const actual = firstCell(await this.#sql(provider, check.statement, scope)); return { label: check.label, expect: check.expect, expected: check.expected, actual, result: meets(actual, check.expect) ? 'pass' : 'fail' }; }
      catch (error) { return { label: check.label, expect: check.expect, expected: check.expected, actual: null, result: 'fail', error: plainError(error) }; }
    }));
    const rowCount = { before: proposal.snapshot.rowCount, after: asNumber(firstCell(await this.#sql(provider, `SELECT COUNT(*) AS row_count FROM ${target}`, scope))) };
    const previews = await Promise.all(proposal.previews.map(async preview => {
      const expected = 'error' in preview.after ? null : preview.after;
      try {
        const board = await this.boards.get(preview.boardId, user, scope);
        const widget = board.widgets.find(item => item.id === preview.widgetId);
        if (!widget) return { boardId: preview.boardId, widgetId: preview.widgetId, title: preview.title, matches: false, expected, actual: null, error: 'The widget is no longer on the board' };
        const result = await this.boards.runAtDefaults(board, widget, user, scope);
        const actual = result.error ? null : trimRows(result, PREVIEW_ROWS, PREVIEW_COLUMNS);
        return { boardId: preview.boardId, widgetId: preview.widgetId, title: preview.title, type: preview.type, viz: preview.viz, matches: Boolean(expected && actual && sameRows(expected, actual)), expected, actual, ...(result.error ? { error: result.error } : {}) };
      } catch (error) { return { boardId: preview.boardId, widgetId: preview.widgetId, title: preview.title, matches: false, expected, actual: null, error: plainError(error) }; }
    }));
    const compared = checks.length + previews.length;
    const status = !compared ? 'inconclusive' : checks.every(check => check.result === 'pass') && previews.every(preview => preview.matches) ? 'passed' : 'failed';
    // FR-15: a passed fix needs the copy no more; a failed one keeps it to look at.
    let sandboxDropped = false;
    if (status === 'passed') { try { await this.#sql(provider, `DROP TABLE IF EXISTS ${sandbox}`, scope, true); sandboxDropped = true; } catch { sandboxDropped = false; } }
    const fix: FixRecord = { proposalId, title: proposal.title, target, status, appliedAt, widgets: proposal.previews.map(preview => ({ boardId: preview.boardId, widgetId: preview.widgetId })) };
    await this.taskStore.updateTask(task.id, { fixes: [...(record?.fixes || []), fix].slice(-20) });
    return fitBudget({ proposalId, applied: true, appliedAt, provider, target, sandbox, title: proposal.title, verification: { status, checks, rowCount, previews }, sandboxDropped, ...(sandboxDropped ? {} : { note: status === 'passed' ? `The sandbox copy ${sandbox} could not be dropped; drop it with drop_fix_sandbox.` : `The sandbox copy ${sandbox} is kept so you can compare it with the table.` }) });
  }
}

type StoredEvent = { type: string; name?: string; toolUseId?: string; content?: unknown; parentToolUseId?: string | null };

/** The latest result of a top-level call to a nervecenter tool whose JSON matches. NerveCenter wrote it, not the agent. */
export function storedResult(events: StoredEvent[], tool: string, match: (data: Dict) => boolean): Dict | null {
  const uses = new Set(events.filter(event => event.type === 'tool.use' && !event.parentToolUseId && new RegExp(`(^|__)${tool}$`).test(String(event.name || ''))).map(event => event.toolUseId));
  for (const event of [...events].reverse()) {
    if (event.type !== 'tool.result' || !uses.has(event.toolUseId)) continue;
    let data: Dict | null = null; try { data = JSON.parse(String(event.content || '')) as Dict; } catch { data = null; }
    if (data && match(data)) return data;
  }
  return null;
}

/** A proposal as `propose_fix` returned it (FR-10). */
export const storedProposal = (events: StoredEvent[], proposalId: string) => storedResult(events, 'propose_fix', data => data.proposalId === proposalId && data.state === 'proposed') as Proposal | null;

/** Columns whose values differ between sample rows that share a key (FR-6). */
function changedColumns(before: { columns: string[]; rows: unknown[][] }, after: { columns: string[]; rows: unknown[][] }, key: string[]): string[] {
  const index = (columns: string[]) => new Map(columns.map((column, at) => [column.toLowerCase(), at]));
  const left = index(before.columns); const right = index(after.columns);
  if (!key.every(column => left.has(column) && right.has(column))) return [];
  const keyOf = (row: unknown[], map: Map<string, number>) => JSON.stringify(key.map(column => String(row[map.get(column)!] ?? '')));
  const byKey = new Map(before.rows.map(row => [keyOf(row, left), row]));
  const changed = new Set<string>();
  for (const row of after.rows) {
    const old = byKey.get(keyOf(row, right)); if (!old) continue;
    for (const [column, at] of right) { const was = left.get(column); if (was !== undefined && String(old[was] ?? '') !== String(row[at] ?? '')) changed.add(after.columns[at]); }
  }
  return [...changed];
}

/** Keep the stored result whole: fewer preview rows, then fewer samples, until it fits. */
function fitBudget<T extends Dict>(result: T): T {
  const size = () => JSON.stringify(result, null, 1).length;
  // The diffs go first: the table change and the widgets are the evidence the person approves on.
  const files = result.files as FileDiff[] | undefined;
  for (const limit of [3000, 1000, 0]) {
    if (!files?.length || size() <= RESULT_BUDGET) break;
    for (const file of files) if (file.diff.length > limit) file.diff = limit ? `${file.diff.slice(0, limit)}
… (cut)` : '(cut to fit)';
  }
  for (const rows of [8, 5, 3, 1]) {
    if (size() <= RESULT_BUDGET) return result;
    const previews = (result.previews || (result.verification as Dict | undefined)?.previews) as Array<Dict> | undefined;
    for (const preview of previews || []) for (const side of ['now', 'after', 'expected', 'actual']) { const value = preview[side] as Rows | undefined; if (value?.rows) value.rows = value.rows.slice(0, rows); }
    const diff = result.diff as { before?: Rows; after?: Rows } | undefined;
    for (const side of [diff?.before, diff?.after]) if (side?.rows) side.rows = side.rows.slice(0, Math.min(rows, SAMPLE_ROWS));
  }
  if (size() > RESULT_BUDGET) throw httpError(400, 'The fix touches too much to show; narrow the change or the checks');
  return result;
}

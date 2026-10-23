import type { TaskEvent } from "@/api/tasks";
import type { WidgetCell, WidgetType, WidgetViz } from "@/api/boards";
import { nervecenterTool } from "../stepLabels";
import { safeParse } from "../taskEvents";

/**
 * Tested fixes on the client (SPEC-tasks-13 FR-8, FR-11, FR-16): the `propose_fix` and `apply_fix` results
 * NerveCenter computed, read into plain data for their cards. Only the tool result is read, never the model's
 * input, so the cards show what the server measured. Pure.
 */

export const FIX_TOOLS = new Set(["propose_fix", "apply_fix"]);

export interface FixRows { columns: string[]; rows: WidgetCell[][] }
export type FixSide = FixRows | { error: string };
export type FixOp = "eq" | "ne" | "gt" | "gte" | "lt" | "lte";
export interface FixTest { name: string; result: "passed" | "failed" | "skipped"; detail: string | null }
export interface FixPreview { boardId: string; boardTitle: string | null; widgetId: string; title: string; type: WidgetType; viz: WidgetViz; now: FixSide; after: FixSide }
export interface FixProposal {
  proposalId: string; title: string; summary: string | null; provider: string; target: string; sandbox: string;
  tests: FixTest[]; testsPassed: number; testsTotal: number;
  diff: { rowsBefore: number | null; rowsAfter: number | null; onlyBefore: number | null; onlyAfter: number | null; changedColumns: string[]; before: FixRows | null; after: FixRows | null };
  checks: Array<{ label: string; op: FixOp; value: string; expected: WidgetCell; predicted: "pass" | "fail" | "error"; error: string | null }>;
  previews: FixPreview[];
  statement: string;
  files: Array<{ path: string; diff: string }>;
}
export type FixVerdict = "passed" | "failed" | "inconclusive";
export interface FixResult {
  proposalId: string; title: string; target: string; sandbox: string; appliedAt: string | null; status: FixVerdict;
  checks: Array<{ label: string; op: FixOp; value: string; expected: WidgetCell; actual: WidgetCell; result: "pass" | "fail"; error: string | null }>;
  rowCount: { before: number | null; after: number | null };
  previews: Array<{ boardId: string; widgetId: string; title: string; type: WidgetType; viz: WidgetViz; matches: boolean; expected: FixRows | null; actual: FixRows | null; error: string | null }>;
  sandboxDropped: boolean; note: string | null;
}

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const objects = (value: unknown, max: number) => (Array.isArray(value) ? value.slice(0, max).filter(isObject) : []);
const cut = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);
const text = (value: unknown, fallback = "", max = 400) => (typeof value === "string" && value.trim() ? cut(value.trim(), max) : typeof value === "number" && Number.isFinite(value) ? String(value) : fallback);
const optional = (value: unknown, max = 400) => (typeof value === "string" && value.trim() ? cut(value.trim(), max) : null);
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const cell = (value: unknown): WidgetCell => (typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" ? cut(value, 200) : value === null || value === undefined ? null : cut(JSON.stringify(value), 200));
const OPS: FixOp[] = ["eq", "ne", "gt", "gte", "lt", "lte"];
const op = (value: unknown): FixOp => (OPS.includes(value as FixOp) ? (value as FixOp) : "eq");
const WIDGET_TYPES: WidgetType[] = ["metric", "table", "chart", "text"];
const widgetType = (value: unknown): WidgetType => (WIDGET_TYPES.includes(value as WidgetType) ? (value as WidgetType) : "table");

function rows(value: unknown): FixRows | null {
  if (!isObject(value) || !Array.isArray(value.columns)) return null;
  const columns = value.columns.slice(0, 12).map((column) => text(column, "—", 80));
  return { columns, rows: (Array.isArray(value.rows) ? value.rows : []).slice(0, 20).filter(Array.isArray).map((row: unknown[]) => columns.map((_, index) => cell(row[index]))) };
}
function side(value: unknown): FixSide {
  if (isObject(value) && typeof value.error === "string") return { error: cut(value.error, 300) };
  return rows(value) ?? { error: "No result" };
}

/** The error a failed tool call reported, as one line. */
export function resultError(result: Pick<TaskEvent, "content" | "isError"> | null): string | null {
  if (!result?.isError) return null;
  return typeof result.content === "string" && result.content.trim() ? cut(result.content.replace(/^Error:\s*/, "").trim(), 300) : "The call failed";
}

export function proposalFrom(data: Record<string, unknown> | null): FixProposal | null {
  if (!data || data.state !== "proposed" || typeof data.proposalId !== "string") return null;
  const diff = isObject(data.diff) ? data.diff : {};
  const apply = isObject(data.apply) ? data.apply : {};
  return {
    proposalId: text(data.proposalId, "", 20), title: text(data.title, "Fix", 160), summary: optional(data.summary), provider: text(data.provider, "databricks", 20),
    target: text(data.target, "—", 200), sandbox: text(data.sandbox, "—", 200),
    tests: objects(data.tests, 12).map((test) => ({ name: text(test.name, "Test", 120), result: test.result === "failed" ? "failed" : test.result === "skipped" ? "skipped" : "passed", detail: optional(test.detail, 300) })),
    testsPassed: num(data.testsPassed) ?? 0, testsTotal: num(data.testsTotal) ?? 0,
    diff: { rowsBefore: num(diff.rowsBefore), rowsAfter: num(diff.rowsAfter), onlyBefore: num(diff.onlyBefore), onlyAfter: num(diff.onlyAfter), changedColumns: Array.isArray(diff.changedColumns) ? diff.changedColumns.slice(0, 12).map((column) => text(column, "", 80)).filter(Boolean) : [], before: rows(diff.before), after: rows(diff.after) },
    checks: objects(data.checks, 8).map((check) => { const expect = isObject(check.expect) ? check.expect : {}; return { label: text(check.label, "Check", 160), op: op(expect.op), value: text(expect.value, "—", 80), expected: cell(check.expected), predicted: check.predicted === "fail" ? "fail" : check.predicted === "error" ? "error" : "pass", error: optional(check.error, 300) }; }),
    previews: objects(data.previews, 3).map((preview) => ({ boardId: text(preview.boardId, "", 80), boardTitle: optional(preview.boardTitle, 120), widgetId: text(preview.widgetId, "", 80), title: text(preview.title, "Widget", 160), type: widgetType(preview.type), viz: isObject(preview.viz) ? (preview.viz as WidgetViz) : {}, now: side(preview.now), after: side(preview.after) })),
    statement: text(apply.statement, "", 4000),
    files: objects(data.files, 5).map((file) => ({ path: text(file.path, "file", 300), diff: text(file.diff, "", 8000) })),
  };
}

export function fixResultFrom(data: Record<string, unknown> | null): FixResult | null {
  if (!data || data.applied !== true || typeof data.proposalId !== "string") return null;
  const verification = isObject(data.verification) ? data.verification : {};
  const count = isObject(verification.rowCount) ? verification.rowCount : {};
  const status: FixVerdict = verification.status === "passed" ? "passed" : verification.status === "failed" ? "failed" : "inconclusive";
  return {
    proposalId: text(data.proposalId, "", 20), title: text(data.title, "Fix", 160), target: text(data.target, "—", 200), sandbox: text(data.sandbox, "—", 200), appliedAt: optional(data.appliedAt, 40), status,
    checks: objects(verification.checks, 8).map((check) => { const expect = isObject(check.expect) ? check.expect : {}; return { label: text(check.label, "Check", 160), op: op(expect.op), value: text(expect.value, "—", 80), expected: cell(check.expected), actual: cell(check.actual), result: check.result === "pass" ? "pass" : "fail", error: optional(check.error, 300) }; }),
    rowCount: { before: num(count.before), after: num(count.after) },
    previews: objects(verification.previews, 3).map((preview) => ({ boardId: text(preview.boardId, "", 80), widgetId: text(preview.widgetId, "", 80), title: text(preview.title, "Widget", 160), type: widgetType(preview.type), viz: isObject(preview.viz) ? (preview.viz as WidgetViz) : {}, matches: preview.matches === true, expected: rows(preview.expected), actual: rows(preview.actual), error: optional(preview.error, 300) })),
    sandboxDropped: data.sandboxDropped === true, note: optional(data.note, 300),
  };
}

/** Every proposal NerveCenter stored in this task, by id: the approval card reads its evidence from here (FR-11). */
export function proposalsFrom(events: TaskEvent[]): Map<string, FixProposal> {
  const uses = new Set(events.filter((event) => event.type === "tool.use" && !event.parentToolUseId && nervecenterTool(event.name) === "propose_fix").map((event) => event.toolUseId));
  const found = new Map<string, FixProposal>();
  for (const event of events) {
    if (event.type !== "tool.result" || event.isError || !uses.has(event.toolUseId)) continue;
    const proposal = proposalFrom(safeParse(event.content));
    if (proposal) found.set(proposal.proposalId, proposal);
  }
  return found;
}

const OP_WORD: Record<FixOp, string> = { eq: "=", ne: "≠", gt: ">", gte: "≥", lt: "<", lte: "≤" };
/** "= 0", "≥ 100": what a check expects. */
export const expectation = (check: { op: FixOp; value: string }) => `${OP_WORD[check.op]} ${check.value}`;

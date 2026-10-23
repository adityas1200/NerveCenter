import type { TaskEvent } from "@/api/tasks";
import { nervecenterTool } from "../stepLabels";
import { safeParse } from "../taskEvents";
import { cardFrom, type Card, type CardTone } from "./cards";
import { FIX_TOOLS, fixResultFrom, proposalFrom, resultError, type FixProposal, type FixResult } from "./fixes";

/**
 * Sonic's component catalog on the client (SPEC-tasks-10, ADR 0009). The backend defines each component in
 * `backend/src/tasks/ui-catalog.mjs`; here every kind has a parser that turns a tool call's input (or, for the
 * data-bound ones, its result) into plain data, dropping what it cannot read. A kind this file does not know
 * becomes a `generic` block, so a component added on the backend shows as a plain card until it has a renderer.
 * Pure.
 */

export type Tone = CardTone;
export type GridState = "ok" | "failed" | "warning" | "running" | "skipped" | "none";
export type FlowState = "done" | "failed" | "stale" | "running" | "pending" | "skipped" | "warning";
export type StepState = "done" | "running" | "failed" | "pending" | "skipped";
export type BarState = "ok" | "failed" | "warning" | "running" | "skipped";
export type HeatScale = "high_is_bad" | "high_is_good" | "neutral";
export type CheckResult = "pass" | "fail" | "open" | "skipped" | "info";
export type OutcomeState = "resolved" | "recovered" | "done" | "answered" | "in_progress" | "blocked" | "needs_you" | "failed";

export interface ActionItem { label: string; kind: "ask" | "open"; prompt: string | null; href: string | null; detail: string | null; needsApproval: boolean }
export interface RunRow { runId: string; status: string; startTime: string | null; endTime: string | null; durationMs: number | null; failure: string | null; ticket: string | null }
export interface TicketView { ticketId: string; number: string | null; title: string; priority: string | null; status: string | null; source: string | null; assignee: string | null; agentFinding: string | null; link: string; updatedAt: string | null }

export type Block =
  | { kind: "chart"; title: string; type: "column" | "bar" | "line" | "area" | "donut"; labels: string[]; series: Array<{ name: string; values: number[] }>; layout: "stacked" | "grouped"; unit: string | null; note: string | null }
  | { kind: "heatmap"; title: string; columns: string[]; rows: Array<{ label: string; values: Array<number | null> }>; scale: HeatScale; unit: string | null; note: string | null }
  | { kind: "gauges"; title: string | null; items: Array<{ label: string; value: number; max: number; target: number | null; unit: string | null; higherIsBetter: boolean; sub: string | null; tone: Tone | null }>; note: string | null }
  | { kind: "funnel"; title: string; stages: Array<{ label: string; value: number; note: string | null }>; unit: string | null; note: string | null }
  | { kind: "gantt"; title: string; lanes: Array<{ label: string; sub: string | null; bars: Array<{ start: number; end: number | null; state: BarState; label: string | null; ask: string | null }> }>; markers: Array<{ at: number; label: string; tone: Tone }>; note: string | null }
  | { kind: "facts"; title: string | null; items: Array<{ label: string; value: string; tone: Tone }>; note: string | null }
  | { kind: "status_grid"; title: string; columns: string[]; rows: Array<{ label: string; sub: string | null; cells: Array<{ state: GridState; label: string | null; ask: string | null }> }>; note: string | null }
  | { kind: "progress"; title: string; state: "running" | "done" | "failed"; steps: Array<{ label: string; state: StepState; seconds: number | null; note: string | null }>; note: string | null }
  | { kind: "flow"; title: string; steps: Array<{ label: string; sub: string | null; state: FlowState }>; note: string | null }
  | { kind: "set_diff"; title: string; leftLabel: string; rightLabel: string; left: string[]; right: string[]; note: string | null }
  | { kind: "checklist"; title: string; items: Array<{ label: string; evidence: string | null; result: CheckResult; ask: string | null }>; note: string | null }
  | { kind: "records"; title: string; items: Array<{ system: string; id: string; title: string | null; from: string | null; to: string; note: string | null; verified: boolean; url: string | null }> }
  | { kind: "notes"; title: string | null; items: Array<{ title: string; text: string; tone: Tone }> }
  | { kind: "email"; to: string[]; cc: string[]; subject: string; body: string; status: "draft" | "sent"; note: string | null }
  | { kind: "document"; title: string; format: "document" | "deck" | "sheet" | "pdf" | "report" | "other"; path: string | null; summary: string | null; outline: Array<{ heading: string; status: "done" | "draft" | "todo" | null }> }
  | { kind: "actions"; title: string | null; items: ActionItem[]; questions: string[] }
  | { kind: "view"; title: string; summary: string | null; blocks: ViewChild[] }
  | { kind: "ticket"; ticket: TicketView | null; note: string | null; error: string | null; pending: boolean }
  | { kind: "pipeline_runs"; pipelineId: string; title: string | null; runs: RunRow[]; note: string | null; error: string | null; pending: boolean }
  /** SPEC-tasks-13: the tested fix NerveCenter measured (`propose_fix`) and its verification once applied (`apply_fix`), from the tool result. */
  | { kind: "fix_proposal"; proposal: FixProposal | null; error: string | null; pending: boolean }
  | { kind: "fix_result"; result: FixResult | null; error: string | null; pending: boolean }
  | { kind: "generic"; title: string; fields: Array<[string, string]>; tables: GenericTable[] };

/** An email reads as the recipient sees it: markdown emphasis, headings and dash bullets become plain text. */
export function plainEmail(body: string): string {
  return body
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/__([^_\n]+)__/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[ \t]*[-*]\s+/gm, "• ");
}

/** A list of records inside a component the page has no renderer for. */
export interface GenericTable { title: string; columns: string[]; rows: string[][]; more: number }

/** One block inside a view: an existing card kind or a catalog block, full or half width. */
export interface ViewChild { width: "full" | "half"; item: { type: "card"; card: Card } | { type: "block"; block: Block } }

/** A drawn component, whichever family it comes from. */
export type Component = { type: "card"; card: Card } | { type: "block"; block: Block };

/* -------------------------------------------------------------- readers */

const MAX = { label: 80, text: 600, title: 160 };
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const list = (value: unknown, max: number): unknown[] => (Array.isArray(value) ? value.slice(0, max) : []);
const objects = (value: unknown, max: number): Array<Record<string, unknown>> => list(value, max).filter(isObject);
const cut = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);
const text = (value: unknown, fallback = "", max = MAX.text): string => (typeof value === "string" && value.trim() ? cut(value.trim(), max) : typeof value === "number" && Number.isFinite(value) ? String(value) : fallback);
const optional = (value: unknown, max = MAX.text): string | null => (typeof value === "string" && value.trim() ? cut(value.trim(), max) : null);
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && value.trim() && Number.isFinite(Number(value)) ? Number(value) : null);
function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T { return allowed.includes(value as T) ? (value as T) : fallback; }
const TONES = ["neutral", "good", "bad", "warning"] as const;
const tone = (value: unknown): Tone => oneOf(value, TONES, "neutral");

/** An `open` target the page may follow: an app route, a task file, or an https link. Anything else is dropped. */
export function safeHref(value: unknown): string | null {
  const href = optional(value, 400);
  if (!href) return null;
  if (href.startsWith("/") && !href.startsWith("//")) return href;
  if (/^https:\/\//i.test(href)) return href;
  if (/^[\w.-]+(\/[\w.-]+)*\.\w+$/.test(href) && !href.includes("..")) return href;
  return null;
}

/* -------------------------------------------------------------- parsers */

type Parser = (input: Record<string, unknown>) => Block | null;

const PARSERS: Record<string, Parser> = {
  chart: (input) => {
    const labels = list(input.labels, 60).map((label) => text(label, "—", 40));
    const series = objects(input.series, 6).map((row) => ({ name: text(row.name, "Series", 60), values: labels.map((_label, index) => num(list(row.values, 60)[index]) ?? 0) })).filter((row) => row.values.length);
    if (!labels.length || !series.length) return null;
    return { kind: "chart", title: text(input.title, "Chart", MAX.title), type: oneOf(input.type, ["column", "bar", "line", "area", "donut"] as const, "column"), labels, series, layout: oneOf(input.layout, ["stacked", "grouped"] as const, "stacked"), unit: optional(input.unit, 20), note: optional(input.note, 240) };
  },
  heatmap: (input) => {
    const columns = list(input.columns, 31).map((column) => text(column, "", 24));
    const rows = objects(input.rows, 14).map((row) => ({ label: text(row.label, "—", MAX.label), values: columns.map((_column, index) => num(list(row.values, 31)[index])) }));
    return columns.length && rows.length ? { kind: "heatmap", title: text(input.title, "Heatmap", MAX.title), columns, rows, scale: oneOf(input.scale, ["high_is_bad", "high_is_good", "neutral"] as const, "neutral"), unit: optional(input.unit, 20), note: optional(input.note, 240) } : null;
  },
  gauges: (input) => {
    const items = objects(input.items, 4).map((row) => ({ label: text(row.label, "—", 60), value: num(row.value), max: num(row.max), target: num(row.target), unit: optional(row.unit, 12), higherIsBetter: row.higherIsBetter !== false, sub: optional(row.sub, MAX.label), tone: row.tone === undefined ? null : tone(row.tone) }))
      .filter((row): row is typeof row & { value: number; max: number } => row.value !== null && row.max !== null && row.max > 0);
    return items.length ? { kind: "gauges", title: optional(input.title, MAX.title), items, note: optional(input.note, 240) } : null;
  },
  funnel: (input) => {
    const stages = objects(input.stages, 8).map((row) => ({ label: text(row.label, "Stage", 60), value: Math.max(0, num(row.value) ?? 0), note: optional(row.note, 120) }));
    return stages.length >= 2 ? { kind: "funnel", title: text(input.title, "Funnel", MAX.title), stages, unit: optional(input.unit, 20), note: optional(input.note, 240) } : null;
  },
  gantt: (input) => {
    const time = (value: unknown) => { const at = typeof value === "string" ? Date.parse(value) : NaN; return Number.isFinite(at) ? at : null; };
    const lanes = objects(input.lanes, 12).map((lane) => ({ label: text(lane.label, "—", MAX.label), sub: optional(lane.sub, MAX.label), bars: objects(lane.bars, 30).map((bar) => ({ start: time(bar.start), end: time(bar.end), state: oneOf(bar.state, ["ok", "failed", "warning", "running", "skipped"] as const, "ok"), label: optional(bar.label, 160), ask: optional(bar.ask, 400) }))
      .filter((bar): bar is typeof bar & { start: number } => bar.start !== null && (bar.end === null || bar.end >= bar.start)) })).filter((lane) => lane.bars.length);
    const markers = objects(input.markers, 4).map((row) => ({ at: time(row.at), label: text(row.label, "", 60), tone: tone(row.tone) })).filter((row): row is typeof row & { at: number } => row.at !== null && Boolean(row.label));
    return lanes.length ? { kind: "gantt", title: text(input.title, "Timeline", MAX.title), lanes, markers, note: optional(input.note, 240) } : null;
  },
  facts: (input) => {
    const items = objects(input.items, 16).map((row) => ({ label: text(row.label, "—", MAX.label), value: text(row.value, "—", 200), tone: tone(row.tone) }));
    return items.length ? { kind: "facts", title: optional(input.title, MAX.title), items, note: optional(input.note, 240) } : null;
  },
  status_grid: (input) => {
    const columns = list(input.columns, 14).map((column) => text(column, "", 24));
    const rows = objects(input.rows, 12).map((row) => ({ label: text(row.label, "—", MAX.label), sub: optional(row.sub, MAX.label), cells: objects(row.cells, columns.length || 14).map((item) => ({ state: oneOf(item.state, ["ok", "failed", "warning", "running", "skipped", "none"] as const, "none"), label: optional(item.label, 200), ask: optional(item.ask, 400) })) }));
    return columns.length && rows.length ? { kind: "status_grid", title: text(input.title, "Status", MAX.title), columns, rows, note: optional(input.note, 240) } : null;
  },
  progress: (input) => {
    const steps = objects(input.steps, 12).map((row) => ({ label: text(row.label, "Step", MAX.label), state: oneOf(row.state, ["done", "running", "failed", "pending", "skipped"] as const, "pending"), seconds: num(row.seconds) !== null && (num(row.seconds) as number) >= 0 ? num(row.seconds) : null, note: optional(row.note, 160) }));
    return steps.length ? { kind: "progress", title: text(input.title, "Progress", MAX.title), state: oneOf(input.state, ["running", "done", "failed"] as const, "done"), steps, note: optional(input.note, 240) } : null;
  },
  flow: (input) => {
    const steps = objects(input.steps, 10).map((row) => ({ label: text(row.label, "Step", 60), sub: optional(row.sub, MAX.label), state: oneOf(row.state, ["done", "failed", "stale", "running", "pending", "skipped", "warning"] as const, "pending") }));
    return steps.length ? { kind: "flow", title: text(input.title, "Flow", MAX.title), steps, note: optional(input.note, 240) } : null;
  },
  set_diff: (input) => {
    const left = list(input.left, 60).map((item) => text(item, "", MAX.label)).filter(Boolean);
    const right = list(input.right, 60).map((item) => text(item, "", MAX.label)).filter(Boolean);
    return left.length || right.length ? { kind: "set_diff", title: text(input.title, "Comparison", MAX.title), leftLabel: text(input.leftLabel, "Before", 40), rightLabel: text(input.rightLabel, "After", 40), left, right, note: optional(input.note, 240) } : null;
  },
  checklist: (input) => {
    const items = objects(input.items, 20).map((row) => ({ label: text(row.label, "Check", MAX.title), evidence: optional(row.evidence, 400), result: oneOf(row.result, ["pass", "fail", "open", "skipped", "info"] as const, "info"), ask: optional(row.ask, 400) }));
    return items.length ? { kind: "checklist", title: text(input.title, "Checks", MAX.title), items, note: optional(input.note, 240) } : null;
  },
  records: (input) => {
    const items = objects(input.items, 12).map((row) => ({ system: text(row.system, "System", 40), id: text(row.id, "—", MAX.label), title: optional(row.title, MAX.title), from: optional(row.from, 40), to: text(row.to, "—", 40), note: optional(row.note, 240), verified: row.verified === true, url: safeHref(row.url) }));
    return items.length ? { kind: "records", title: text(input.title, "Records changed", MAX.title), items } : null;
  },
  notes: (input) => {
    const items = objects(input.items, 6).map((row) => ({ title: text(row.title, "", 120), text: text(row.text, "", 400), tone: tone(row.tone) })).filter((row) => row.title || row.text);
    return items.length ? { kind: "notes", title: optional(input.title, MAX.label), items } : null;
  },
  email: (input) => {
    const to = list(input.to, 20).map((item) => text(item, "", 200)).filter(Boolean);
    const subject = text(input.subject, "", 200);
    if (!to.length && !subject) return null;
    return { kind: "email", to, cc: list(input.cc, 20).map((item) => text(item, "", 200)).filter(Boolean), subject, body: plainEmail(text(input.body, "", 6000)), status: oneOf(input.status, ["draft", "sent"] as const, "draft"), note: optional(input.note, 240) };
  },
  document: (input) => ({ kind: "document", title: text(input.title, "Document", MAX.title), format: oneOf(input.format, ["document", "deck", "sheet", "pdf", "report", "other"] as const, "document"), path: optional(input.path, 300), summary: optional(input.summary, 400), outline: objects(input.outline, 20).map((row) => ({ heading: text(row.heading, "Section", 120), status: row.status === "done" || row.status === "draft" || row.status === "todo" ? row.status : null })) }),
  actions: (input) => {
    const items: ActionItem[] = objects(input.items, 6).map((row) => ({ label: text(row.label, "", 60), kind: row.kind === "open" ? "open" as const : "ask" as const, prompt: optional(row.prompt, 600), href: safeHref(row.href), detail: optional(row.detail, MAX.label), needsApproval: row.needsApproval === true })).filter((item) => item.label && (item.kind === "ask" ? item.prompt : item.href));
    const questions = list(input.questions, 3).map((item) => text(item, "", 160)).filter(Boolean);
    return items.length || questions.length ? { kind: "actions", title: optional(input.title, MAX.label), items, questions } : null;
  },
  view: (input) => {
    const blocks: ViewChild[] = [];
    for (const row of objects(input.blocks, 12)) {
      const kind = text(row.kind);
      const item = componentOf(kind, row);
      if (item) blocks.push({ width: row.width === "half" ? "half" : "full", item });
    }
    return blocks.length ? { kind: "view", title: text(input.title, "View", MAX.title), summary: optional(input.summary, 300), blocks } : null;
  },
};

/** The kinds whose renderers live in `cards.ts` (the first cards Sonic had), by their name inside a view. */
const CARD_KINDS: Record<string, string> = { table: "show_table", timeline: "show_timeline", comparison: "show_comparison", metrics: "show_metrics", lineage: "show_lineage", change: "show_change", pull_request: "show_pull_request" };

/** A tool's kind: show_status_grid → status_grid. */
export const TOOL_KIND: Record<string, string> = {
  show_chart: "chart", show_facts: "facts", show_heatmap: "heatmap", show_gauges: "gauges", show_funnel: "funnel", show_gantt: "gantt", show_status_grid: "status_grid", show_progress: "progress", show_flow: "flow", show_set_diff: "set_diff",
  show_checklist: "checklist", show_records: "records", show_notes: "notes", show_email: "email", show_document: "document", show_actions: "actions", show_view: "view",
  show_ticket: "ticket", show_pipeline_runs: "pipeline_runs",
};
/** The data-bound tools: they render what the server read, from the tool result. */
export const BOUND_TOOLS = new Set(["show_ticket", "show_pipeline_runs"]);
const CARD_TOOLS = new Set(Object.values(CARD_KINDS));

function componentOf(kind: string, input: Record<string, unknown>): Component | null {
  if (CARD_KINDS[kind]) { const card = cardFrom({ type: "tool.use", name: `mcp__nervecenter__${CARD_KINDS[kind]}`, input: JSON.stringify(input) }); return card ? { type: "card", card } : null; }
  const parser = PARSERS[kind];
  if (parser) { const block = parser(input); return block ? { type: "block", block } : null; }
  return { type: "block", block: genericBlock(kind, input) };
}

const words = (key: string) => key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/^./, (letter) => letter.toUpperCase());
const scalar = (value: unknown): value is string | number | boolean => typeof value === "string" || typeof value === "number" || typeof value === "boolean";

/**
 * Any component the page has no renderer for yet (a kind added on the backend first, or a skill's own `show_*`
 * tool): its data read by shape, so it is still worth reading. Scalars become facts, a list of scalars a
 * line, a list of records a table (columns from the records' keys), a nested record facts of its own.
 */
export function genericBlock(kind: string, input: Record<string, unknown>): Block {
  const title = text(input.title, kind ? words(kind.replace(/^show_/, "")) : "Details", MAX.title);
  const fields: Array<[string, string]> = [];
  const tables: GenericTable[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (key === "title" || key === "kind" || key === "width" || value === null || value === undefined) continue;
    const label = words(key);
    if (scalar(value)) fields.push([label, cut(String(value), 400)]);
    else if (Array.isArray(value) && value.every(scalar)) fields.push([label, cut(value.join(", "), 400)]);
    else if (Array.isArray(value) && value.length && value.every(isObject)) tables.push(tableOf(label, value as Array<Record<string, unknown>>));
    else if (isObject(value)) { for (const [inner, item] of Object.entries(value).slice(0, 8)) fields.push([`${label} · ${words(inner)}`, cut(scalar(item) ? String(item) : JSON.stringify(item), 200)]); }
    else fields.push([label, cut(JSON.stringify(value), 400)]);
    if (fields.length >= 16 || tables.length >= 3) break;
  }
  return { kind: "generic", title, fields: fields.slice(0, 16), tables };
}

function tableOf(title: string, rows: Array<Record<string, unknown>>): GenericTable {
  const columns: string[] = [];
  for (const row of rows.slice(0, 20)) for (const key of Object.keys(row)) if (!columns.includes(key) && columns.length < 8) columns.push(key);
  return { title, columns: columns.map(words), rows: rows.slice(0, 20).map((row) => columns.map((column) => { const value = row[column]; return value === null || value === undefined ? "" : cut(scalar(value) ? String(value) : JSON.stringify(value), 120); })), more: Math.max(0, rows.length - 20) };
}

/** Whether a top-level tool call draws a component in the thread (known or not yet known). */
export function isComponentTool(name?: string | null): boolean {
  const tool = nervecenterTool(name || undefined);
  if (!tool) return false;
  return CARD_TOOLS.has(tool) || FIX_TOOLS.has(tool) || Boolean(TOOL_KIND[tool]) || /^show_/.test(tool) && tool !== "show_artifact";
}

function boundFrom(tool: string, input: Record<string, unknown>, result: Pick<TaskEvent, "content" | "isError"> | null): Block {
  const pending = !result;
  const error = result?.isError ? (typeof result.content === "string" ? result.content.replace(/^Error:\s*/, "").slice(0, 300) : "Could not read it") : null;
  const data = result && !result.isError ? safeParse(result.content) : null;
  if (tool === "show_ticket") {
    const raw = isObject(data?.ticket) ? data.ticket : null;
    const ticket: TicketView | null = raw ? { ticketId: text(raw.ticketId, "—", 40), number: optional(raw.number, 40), title: text(raw.title, "Ticket", 200), priority: optional(raw.priority, 20), status: optional(raw.status, 40), source: optional(raw.source, 40), assignee: optional(raw.assignee, 80), agentFinding: optional(raw.agentFinding, 400), link: safeHref(raw.link) || `/tickets/${encodeURIComponent(text(raw.ticketId))}`, updatedAt: optional(raw.updatedAt, 40) } : null;
    return { kind: "ticket", ticket, note: optional(input.note, 240), error: error || (!pending && !ticket ? "The ticket could not be read" : null), pending };
  }
  const runs: RunRow[] = objects(data?.runs, 20).map((run) => ({ runId: text(run.runId, "—", 60), status: text(run.status, "unknown", 30).toLowerCase(), startTime: optional(run.startTime, 40), endTime: optional(run.endTime, 40), durationMs: num(run.durationMs), failure: optional(run.failure, 300), ticket: optional(run.ticket, 40) }));
  return { kind: "pipeline_runs", pipelineId: text(input.pipelineId, "—", 200), title: optional(input.title, MAX.title), runs, note: optional(input.note, 240), error, pending };
}

function fixFrom(tool: string, result: Pick<TaskEvent, "content" | "isError"> | null): Block {
  const pending = !result;
  const error = resultError(result);
  const data = result && !result.isError ? safeParse(result.content) : null;
  if (tool === "propose_fix") { const proposal = proposalFrom(data); return { kind: "fix_proposal", proposal, error: error || (!pending && !proposal ? "The proposal could not be read" : null), pending }; }
  const applied = fixResultFrom(data);
  return { kind: "fix_result", result: applied, error: error || (!pending && !applied ? "The result could not be read" : null), pending };
}

/**
 * One top-level component call as data for its renderer. Cards from the first catalog keep their `cards.ts`
 * parsers; data-bound calls read their result (pending until it lands); unknown `show_*` calls become generic.
 */
export function componentFrom(event: Pick<TaskEvent, "type" | "name" | "input">, result: Pick<TaskEvent, "content" | "isError"> | null = null): Component | null {
  if (event.type !== "tool.use") return null;
  const tool = nervecenterTool(event.name);
  if (!tool) return null;
  if (CARD_TOOLS.has(tool)) { const card = cardFrom(event); return card ? { type: "card", card } : null; }
  const input = safeParse(event.input) || {};
  if (BOUND_TOOLS.has(tool)) return { type: "block", block: boundFrom(tool, input, result) };
  if (FIX_TOOLS.has(tool)) return { type: "block", block: fixFrom(tool, result) };
  const kind = TOOL_KIND[tool];
  if (kind && PARSERS[kind]) { const block = PARSERS[kind](input); return block ? { type: "block", block } : null; }
  if (/^show_/.test(tool)) return { type: "block", block: genericBlock(tool, input) };
  return null;
}

/* ------------------------------------------------------- steering reads */

export interface Outcome { state: OutcomeState; headline: string; items: Array<{ label: string; value: string; tone: Tone }>; eventId: string }
export interface Explanation { title: string; what: string; checks: string[]; impact: string | null; rollback: string | null; ifFails: string | null }

export function outcomeFrom(event: Pick<TaskEvent, "id" | "type" | "name" | "input">): Outcome | null {
  if (event.type !== "tool.use" || nervecenterTool(event.name) !== "set_outcome") return null;
  const input = safeParse(event.input);
  const headline = text(input?.headline, "", 160);
  if (!input || !headline) return null;
  return { state: oneOf(input.state, ["resolved", "recovered", "done", "answered", "in_progress", "blocked", "needs_you", "failed"] as const, "in_progress"), headline, items: objects(input.items, 5).map((row) => ({ label: text(row.label, "", 40), value: text(row.value, "", 60), tone: tone(row.tone) })).filter((row) => row.label || row.value), eventId: event.id };
}

export function explanationFrom(event: Pick<TaskEvent, "type" | "name" | "input">): Explanation | null {
  if (event.type !== "tool.use" || nervecenterTool(event.name) !== "explain_action") return null;
  const input = safeParse(event.input);
  const title = text(input?.title, "", 120);
  if (!input || !title) return null;
  return { title, what: text(input.what, "", 400), checks: list(input.checks, 6).map((item) => text(item, "", 160)).filter(Boolean), impact: optional(input.impact, 240), rollback: optional(input.rollback, 240), ifFails: optional(input.ifFails, 240) };
}

/** The follow-up questions of the latest `show_actions` call after the reader's last message: chips above the composer. */
export function followUpsFrom(events: TaskEvent[]): string[] {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === "user.message") return [];
    if (event.type === "tool.use" && !event.parentToolUseId && nervecenterTool(event.name) === "show_actions") {
      const block = PARSERS.actions(safeParse(event.input) || {});
      return block && block.kind === "actions" ? block.questions : [];
    }
  }
  return [];
}

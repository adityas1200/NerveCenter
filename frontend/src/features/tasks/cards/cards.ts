import type { TaskEvent } from "@/api/tasks";
import { nervecenterTool } from "../stepLabels";
import { safeParse } from "../taskEvents";

/**
 * The agent's drawing tools, folded from `tool.use` events into plain data the cards render. Pure.
 * `planFrom` builds the checklist from the last `propose_plan` plus every later `update_plan`;
 * `cardFrom` turns one `show_*` call into a card.
 */

export type PlanStepKind = "read" | "change" | "check";
export type PlanStepState = "pending" | "active" | "done" | "skipped" | "blocked";
export interface PlanStep { id: string; text: string; kind: PlanStepKind; state: PlanStepState; note: string | null }
export interface Plan { eventId: string; seq: number; at: string; title: string | null; steps: PlanStep[]; done: number; total: number }

const KINDS = new Set<PlanStepKind>(["read", "change", "check"]);
const STATES = new Set<PlanStepState>(["active", "done", "skipped", "blocked"]);

export function planFrom(events: TaskEvent[], live: boolean): Plan | null {
  let proposal: TaskEvent | null = null;
  for (const event of events) if (event.type === "tool.use" && nervecenterTool(event.name) === "propose_plan") proposal = event;
  if (!proposal) return null;
  const input = safeParse(proposal.input);
  const rawSteps = Array.isArray(input?.steps) ? (input.steps as Array<Record<string, unknown>>) : [];
  const steps: PlanStep[] = rawSteps.filter((step) => step && typeof step === "object").map((step, index) => ({
    id: String(step.id ?? `s${index + 1}`),
    text: String(step.text ?? ""),
    kind: KINDS.has(step.kind as PlanStepKind) ? (step.kind as PlanStepKind) : "read",
    state: "pending",
    note: null,
  }));
  if (!steps.length) return null;
  const byId = new Map(steps.map((step) => [step.id, step]));
  for (const event of events) {
    if (event.seq <= proposal.seq || event.type !== "tool.use" || nervecenterTool(event.name) !== "update_plan") continue;
    const update = safeParse(event.input);
    const step = byId.get(String(update?.stepId ?? ""));
    if (!step) continue;
    const state = update?.state as PlanStepState;
    if (STATES.has(state)) step.state = state;
    if (typeof update?.note === "string" && update.note.trim()) step.note = update.note.trim();
  }
  // While the agent runs, the first step still pending after the last finished one is the one it is on.
  if (live && !steps.some((step) => step.state === "active")) {
    let lastDone = -1;
    steps.forEach((step, index) => { if (step.state === "done" || step.state === "skipped" || step.state === "blocked") lastDone = index; });
    const next = steps.slice(lastDone + 1).find((step) => step.state === "pending");
    if (next) next.state = "active";
  }
  if (!live) for (const step of steps) if (step.state === "active") step.state = "pending";
  return { eventId: proposal.id, seq: proposal.seq, at: proposal.at, title: typeof input?.title === "string" && input.title.trim() ? input.title.trim() : null, steps, done: steps.filter((step) => step.state === "done").length, total: steps.length };
}

/* ------------------------------------------------------------------ cards */

export type CardTone = "neutral" | "good" | "bad" | "warning";
export type CellValue = string | number | null;
export type Card =
  | { kind: "table"; title: string; columns: string[]; rows: CellValue[][]; note: string | null }
  | { kind: "timeline"; title: string; events: Array<{ at: string; text: string; tone: CardTone }>; note: null }
  | { kind: "comparison"; title: string; beforeLabel: string; afterLabel: string; rows: Array<{ label: string; before: CellValue; after: CellValue; changed: boolean }>; note: null }
  | { kind: "metrics"; title: null; items: Array<{ label: string; value: string | number; suffix: string | null; delta: string | null; trend: number[]; tone: CardTone }>; note: null }
  | { kind: "pull_request"; title: string; pullRequest: PullRequestCard; note: string | null }
  | { kind: "lineage"; title: string; focus: string | null; nodes: LineageNode[]; edges: LineageEdge[]; note: string | null }
  | { kind: "change"; title: string; summary: string | null; state: ChangeState; files: ChangeFile[]; testing: ChangeTesting | null; link: string | null; note: null }
  | { kind: "query"; title: string; statement: string; provider: string | null; tables: string[]; result: QueryResult | null; note: null };

export type LineageNodeKind = "source" | "table" | "view" | "job" | "pipeline" | "model" | "file" | "dashboard" | "board" | "report" | "api" | "other";
export type LineageStatus = "ok" | "failed" | "stale" | "affected" | "unknown";
export interface LineageNode { id: string; label: string; kind: LineageNodeKind; system: string | null; status: LineageStatus; owner: string | null; note: string | null }
export interface LineageEdge { from: string; to: string; label: string | null }
export type ChangeState = "proposed" | "applied" | "reverted";
export interface ChangeFile { path: string; diff: string; additions: number; deletions: number }
export interface ChangeTesting { method: string; result: "passed" | "failed" | "inconclusive" | "not_tested"; detail: string | null }
export interface QueryResult { columns: string[]; rows: CellValue[][]; rowCount: number; durationMs: number | null; error: string | null }

const LINEAGE_KINDS = new Set<LineageNodeKind>(["source", "table", "view", "job", "pipeline", "model", "file", "dashboard", "board", "report", "api", "other"]);
const LINEAGE_STATUSES = new Set<LineageStatus>(["ok", "failed", "stale", "affected", "unknown"]);
const CHANGE_STATES = new Set<ChangeState>(["proposed", "applied", "reverted"]);
const TEST_RESULTS = new Set<ChangeTesting["result"]>(["passed", "failed", "inconclusive", "not_tested"]);

export type PullRequestState = "open" | "draft" | "merged" | "closed";
export interface PullRequestCard { url: string; number: number; repository: string; branch: string; base: string; state: PullRequestState; ticketId: string | null; additions: number | null; deletions: number | null; files: number | null }
const PR_STATES = new Set<PullRequestState>(["open", "draft", "merged", "closed"]);
const PR_URL = /^https:\/\/(?:github\.com|bitbucket\.org)\/([\w.-]+\/[\w.-]+)\/pull(?:-requests)?\/(\d+)\/?$/;
const count = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null);

const TONES = new Set<CardTone>(["neutral", "good", "bad", "warning"]);
const tone = (value: unknown): CardTone => (TONES.has(value as CardTone) ? (value as CardTone) : "neutral");
const cell = (value: unknown): CellValue => (typeof value === "number" || typeof value === "string" ? value : value === null || value === undefined ? null : String(value));
const text = (value: unknown, fallback = ""): string => (typeof value === "string" && value.trim() ? value.trim() : typeof value === "number" ? String(value) : fallback);
const optional = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

/** The query a `query_data` call ran, with what came back when its result is known. */
export function queryCardFrom(event: Pick<TaskEvent, "type" | "name" | "input">, result?: Pick<TaskEvent, "content" | "isError"> | null): Extract<Card, { kind: "query" }> | null {
  if (event.type !== "tool.use" || nervecenterTool(event.name) !== "query_data") return null;
  const input = safeParse(event.input);
  const statement = text(input?.statement);
  if (!statement) return null;
  let parsed: QueryResult | null = null;
  if (result) {
    const body = typeof result.content === "string" ? result.content : "";
    if (result.isError) parsed = { columns: [], rows: [], rowCount: 0, durationMs: null, error: body.replace(/^Error:\s*/, "").slice(0, 400) || "The query failed" };
    else {
      const data = safeParse(body);
      const columns = Array.isArray(data?.columns) ? data.columns.map((column) => text(typeof column === "object" && column ? (column as Record<string, unknown>).name : column, "—")) : [];
      const rows = Array.isArray(data?.rows) ? data.rows.slice(0, 50).map((row) => Array.isArray(row) ? row.map(cell) : columns.map((column) => cell((row as Record<string, unknown>)?.[column]))) : [];
      parsed = data ? { columns, rows, rowCount: count(data.rowCount) ?? rows.length, durationMs: count(data.durationMs), error: null } : null;
    }
  }
  const tables = statement.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, " ").match(/\b(?:FROM|JOIN)\s+[`"[]?[\w$-]+[`"\]]?(?:\.[`"[]?[\w$-]+[`"\]]?){0,2}/gi)?.map((match) => match.replace(/^\w+\s+/, "").replace(/[`"[\]]/g, "")).filter((name) => !/^(?:select|lateral|unnest|values)$/i.test(name)) ?? [];
  return { kind: "query", title: text(input?.purpose, "Query"), statement, provider: optional(input?.provider), tables: [...new Set(tables)], result: parsed, note: null };
}

const diffCounts = (diff: string) => { let additions = 0; let deletions = 0; for (const line of diff.split("\n")) { if (line.startsWith("+++") || line.startsWith("---")) continue; if (line.startsWith("+")) additions += 1; else if (line.startsWith("-")) deletions += 1; } return { additions, deletions }; };

export function cardFrom(event: Pick<TaskEvent, "type" | "name" | "input">): Card | null {
  if (event.type !== "tool.use") return null;
  const tool = nervecenterTool(event.name);
  const input = safeParse(event.input);
  if (!tool || !input) return null;
  if (tool === "show_lineage") {
    const nodes: LineageNode[] = Array.isArray(input.nodes) ? input.nodes.filter((item) => item && typeof item === "object").map((item) => { const row = item as Record<string, unknown>; const id = text(row.id); return { id, label: text(row.label, id), kind: LINEAGE_KINDS.has(row.kind as LineageNodeKind) ? (row.kind as LineageNodeKind) : "table", system: optional(row.system), status: LINEAGE_STATUSES.has(row.status as LineageStatus) ? (row.status as LineageStatus) : "unknown", owner: optional(row.owner), note: optional(row.note) }; }).filter((node) => node.id) : [];
    if (!nodes.length) return null;
    const ids = new Set(nodes.map((node) => node.id));
    const edges: LineageEdge[] = Array.isArray(input.edges) ? input.edges.filter((item) => item && typeof item === "object").map((item) => { const row = item as Record<string, unknown>; return { from: text(row.from), to: text(row.to), label: optional(row.label) }; }).filter((edge) => ids.has(edge.from) && ids.has(edge.to) && edge.from !== edge.to) : [];
    return { kind: "lineage", title: text(input.title, "Lineage"), focus: optional(input.focus), nodes, edges, note: optional(input.note) };
  }
  if (tool === "show_change") {
    const files: ChangeFile[] = Array.isArray(input.files) ? input.files.filter((item) => item && typeof item === "object").map((item) => { const row = item as Record<string, unknown>; const diff = typeof row.diff === "string" ? row.diff : ""; return { path: text(row.path, "file"), diff, ...diffCounts(diff) }; }) : [];
    if (!files.length) return null;
    const testingInput = input.testing && typeof input.testing === "object" ? (input.testing as Record<string, unknown>) : null;
    const testing: ChangeTesting | null = testingInput ? { method: text(testingInput.method, "Tested"), result: TEST_RESULTS.has(testingInput.result as ChangeTesting["result"]) ? (testingInput.result as ChangeTesting["result"]) : "inconclusive", detail: optional(testingInput.detail) } : null;
    const link = optional(input.link);
    return { kind: "change", title: text(input.title, "Change"), summary: optional(input.summary), state: CHANGE_STATES.has(input.state as ChangeState) ? (input.state as ChangeState) : "proposed", files, testing, link: link && /^https?:\/\//i.test(link) ? link : null, note: null };
  }
  if (tool === "show_table") {
    const columns = Array.isArray(input.columns) ? input.columns.map((column) => text(column, "—")) : [];
    const rows = Array.isArray(input.rows) ? input.rows.filter(Array.isArray).map((row) => columns.map((_column, index) => cell((row as unknown[])[index]))) : [];
    if (!columns.length) return null;
    return { kind: "table", title: text(input.title, "Table"), columns, rows, note: optional(input.note) };
  }
  if (tool === "show_timeline") {
    const events = Array.isArray(input.events) ? input.events.filter((item) => item && typeof item === "object").map((item) => { const row = item as Record<string, unknown>; return { at: text(row.at, "—"), text: text(row.text), tone: tone(row.tone) }; }) : [];
    if (!events.length) return null;
    return { kind: "timeline", title: text(input.title, "Timeline"), events, note: null };
  }
  if (tool === "show_comparison") {
    const rows = Array.isArray(input.rows) ? input.rows.filter((item) => item && typeof item === "object").map((item) => { const row = item as Record<string, unknown>; return { label: text(row.label, "—"), before: cell(row.before), after: cell(row.after), changed: typeof row.changed === "boolean" ? row.changed : String(row.before ?? "") !== String(row.after ?? "") }; }) : [];
    if (!rows.length) return null;
    return { kind: "comparison", title: text(input.title, "Comparison"), beforeLabel: text(input.beforeLabel, "Before"), afterLabel: text(input.afterLabel, "After"), rows, note: null };
  }
  if (tool === "show_metrics") {
    const items = Array.isArray(input.items) ? input.items.filter((item) => item && typeof item === "object").map((item) => { const row = item as Record<string, unknown>; return { label: text(row.label, "—"), value: typeof row.value === "number" ? row.value : text(row.value, "—"), suffix: optional(row.suffix), delta: optional(row.delta), trend: Array.isArray(row.trend) ? row.trend.slice(-30).filter((value): value is number => typeof value === "number" && Number.isFinite(value)) : [], tone: tone(row.tone) }; }) : [];
    if (!items.length) return null;
    return { kind: "metrics", title: null, items, note: null };
  }
  if (tool === "show_pull_request") {
    // Only a real GitHub or Bitbucket pull request link becomes a card; the repository and number come from the URL.
    const match = PR_URL.exec(text(input.url));
    if (!match) return null;
    const state = PR_STATES.has(input.state as PullRequestState) ? (input.state as PullRequestState) : "open";
    return {
      kind: "pull_request",
      title: text(input.title, `Pull request #${match[2]}`),
      pullRequest: { url: match[0], number: Number(match[2]), repository: match[1], branch: text(input.branch, "—"), base: text(input.base, "main"), state, ticketId: optional(input.ticketId), additions: count(input.additions), deletions: count(input.deletions), files: count(input.files) },
      note: optional(input.summary),
    };
  }
  return null;
}

/** Every card in the thread, in event order (top-level calls only). */
export function cardsFrom(events: TaskEvent[]): Array<{ event: TaskEvent; card: Card }> {
  const out: Array<{ event: TaskEvent; card: Card }> = [];
  for (const event of events) { if (event.parentToolUseId) continue; const card = cardFrom(event); if (card) out.push({ event, card }); }
  return out;
}

/* ------------------------------------------------------------------ artifacts */

export type ArtifactKind = "report" | "dashboard" | "document" | "image";
/** How the frame draws the file: a sandboxed page, a picture, rendered markdown, the PDF viewer, or a plain link. */
export type ArtifactMedia = "html" | "image" | "markdown" | "pdf" | "other";
export interface Artifact {
  /** The `show_artifact` event, or `file:<path>` when an older task's HTML file stands in for one. */
  eventId: string; seq: number; at: string;
  /** Relative to the task folder, as the raw endpoint wants it. */
  path: string; name: string; title: string; kind: ArtifactKind; summary: string | null; media: ArtifactMedia;
}

const ARTIFACT_KINDS = new Set<ArtifactKind>(["report", "dashboard", "document", "image"]);
export const ARTIFACT_KIND_LABEL: Record<ArtifactKind, string> = { report: "Report", dashboard: "Dashboard", document: "Document", image: "Image" };

export function artifactMedia(path: string): ArtifactMedia {
  const ext = (path.split(".").pop() || "").toLowerCase();
  if (ext === "html" || ext === "htm") return "html";
  if (["svg", "png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return "image";
  if (ext === "md" || ext === "markdown") return "markdown";
  if (ext === "pdf") return "pdf";
  return "other";
}
const defaultKind = (media: ArtifactMedia): ArtifactKind => (media === "html" ? "report" : media === "image" ? "image" : "document");

/** "tasks/T-1031/report.html", "./report.html" and "report.html" all name the same file inside the task folder. */
export function relativeArtifactPath(path: string, taskId?: string): string {
  let relative = path.replace(/\\/g, "/").replace(/^\.\//, "");
  if (taskId) relative = relative.replace(new RegExp(`^(?:.*/)?tasks/${taskId.replace(/[^\w-]/g, "")}/`), "");
  return relative;
}

/** One `show_artifact` call as the frame's data; nothing for any other event or an unusable path. */
export function artifactFrom(event: Pick<TaskEvent, "id" | "seq" | "at" | "type" | "name" | "input" | "taskId">): Artifact | null {
  if (event.type !== "tool.use" || nervecenterTool(event.name) !== "show_artifact") return null;
  const input = safeParse(event.input);
  const path = relativeArtifactPath(text(input?.path), event.taskId);
  if (!path || path.includes("..")) return null;
  const media = artifactMedia(path);
  const name = path.split("/").pop() || path;
  return { eventId: event.id, seq: event.seq, at: event.at, path, name, title: text(input?.title, name), kind: ARTIFACT_KINDS.has(input?.kind as ArtifactKind) ? (input?.kind as ArtifactKind) : defaultKind(media), summary: optional(input?.summary), media };
}

/** Every artifact the agent showed, in event order (top-level calls only); a path shown twice keeps its last call. */
export function artifactsFrom(events: TaskEvent[]): Artifact[] {
  const byPath = new Map<string, Artifact>();
  for (const event of events) { if (event.parentToolUseId) continue; const artifact = artifactFrom(event); if (artifact) { byPath.delete(artifact.path); byPath.set(artifact.path, artifact); } }
  return [...byPath.values()];
}

/** Ticket ids a reader can open: OPS-12, INC0031300, CDO-124. */
export const TICKET_ID = /^(OPS-\d+|INC\d+|CDO-\d+)$/i;
export const isTicketId = (value: CellValue): value is string => typeof value === "string" && TICKET_ID.test(value.trim());
const NUMERIC = /^[-+]?[\d,]*\.?\d+\s*%?$/;
export const isNumeric = (value: CellValue): boolean => typeof value === "number" || (typeof value === "string" && NUMERIC.test(value.trim()) && value.trim() !== "");

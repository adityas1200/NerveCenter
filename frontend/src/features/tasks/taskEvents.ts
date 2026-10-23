import type { QuestionAnswers, QuestionSpec } from "@/api/inbox";
import type { TaskEvent } from "@/api/tasks";
import { BOUND_TOOLS, explanationFrom, isComponentTool, type Explanation } from "./cards/blocks";
import { FIX_TOOLS } from "./cards/fixes";
import { nervecenterTool } from "./stepLabels";
import { isFileWrite } from "./tools";

/** Pure helpers over the task event stream, shared by the thread, the task page and the panel. */

export type ThreadGroup =
  | { kind: "user"; event: TaskEvent }
  | { kind: "assistant"; event: TaskEvent }
  | { kind: "steps"; events: TaskEvent[]; live: boolean }
  /** A catalog component call (`show_*`): drawn where it sits. Data-bound ones carry their result once it lands. */
  | { kind: "component"; event: TaskEvent; result: TaskEvent | null }
  /** A `show_artifact` call: the file it names is framed where it sits (a report, a dashboard, an image). */
  | { kind: "artifact"; event: TaskEvent }
  /** The `propose_plan` call: rendered as the plan card in place of the step. */
  | { kind: "plan"; event: TaskEvent }
  /** The turn's `record_finding` calls, drawn as one investigation card where the first one sits. */
  | { kind: "findings"; events: TaskEvent[] }
  /**
   * An approval drawn in view: one Sonic explained first (`explain_action`), or an `apply_fix` approval, which
   * carries its tested proposal (SPEC-tasks-13 FR-11). Its decision once made.
   */
  | { kind: "approval"; event: TaskEvent; explanation: Explanation | null; decided: TaskEvent | null }
  /** A question the agent asked, with its answer once given. The pending one renders as a form. */
  | { kind: "question"; event: TaskEvent; answered: TaskEvent | null }
  | { kind: "error"; event: TaskEvent }
  | { kind: "status"; event: TaskEvent }
  /** The SDK's `result` event closing out a turn: cost, duration and turn count. */
  | { kind: "result"; event: TaskEvent };

const STEP_TYPES = new Set(["session.init", "tool.use", "tool.result", "approval.requested", "approval.decided", "approval.denied"]);
/**
 * Tools drawn by something else, never repeated as a step: plan updates by the plan card, questions and
 * forms by their `question.asked` event, the outcome by the outcome line, explanations by their approval.
 */
const SILENT_TOOLS = new Set(["update_plan", "set_outcome", "request_input", "explain_action"]);
const isSilent = (name?: string) => name === "AskUserQuestion" || SILENT_TOOLS.has(nervecenterTool(name) || "");

export function groupEvents(events: TaskEvent[], taskLive: boolean): ThreadGroup[] {
  const groups: ThreadGroup[] = [];
  const hidden = new Set<string>();
  const questions = new Map<string, Extract<ThreadGroup, { kind: "question" }>>();
  const bound = new Map<string, Extract<ThreadGroup, { kind: "component" }>>();
  const approvals = new Map<string, Extract<ThreadGroup, { kind: "approval" }>>();
  let findings: Extract<ThreadGroup, { kind: "findings" }> | null = null;
  // The explanation waits for the approval it describes; the next real tool result, a new explanation or a new message drops it.
  let explanation: Explanation | null = null;
  // An apply_fix call waits on its approval, so its result card belongs after the approval card, not before it.
  let applying: Extract<ThreadGroup, { kind: "component" }> | null = null;
  for (const event of events) {
    const tool = nervecenterTool(event.name);
    const top = !event.parentToolUseId;
    if (event.type === "user.message") { groups.push({ kind: "user", event }); findings = null; explanation = null; }
    else if (event.type === "assistant.text") { if (top) groups.push({ kind: "assistant", event }); }
    else if (event.type === "error") groups.push({ kind: "error", event });
    else if (event.type === "status") groups.push({ kind: "status", event });
    else if (event.type === "result") groups.push({ kind: "result", event });
    else if (event.type === "question.asked") { const group: Extract<ThreadGroup, { kind: "question" }> = { kind: "question", event, answered: null }; groups.push(group); if (event.inboxId) questions.set(event.inboxId, group); }
    else if (event.type === "question.answered") { const group = event.inboxId ? questions.get(event.inboxId) : undefined; if (group) group.answered = event; }
    else if (event.type === "tool.use" && top && tool === "show_artifact") { hide(hidden, event); groups.push({ kind: "artifact", event }); }
    else if (event.type === "tool.use" && top && tool === "propose_plan") { hide(hidden, event); groups.push({ kind: "plan", event }); }
    else if (event.type === "tool.use" && top && tool === "record_finding") { hide(hidden, event); if (findings) findings.events.push(event); else { findings = { kind: "findings", events: [event] }; groups.push(findings); } }
    else if (event.type === "tool.use" && top && isComponentTool(event.name)) { hide(hidden, event); const group: Extract<ThreadGroup, { kind: "component" }> = { kind: "component", event, result: null }; groups.push(group); if (event.toolUseId && (BOUND_TOOLS.has(tool || "") || FIX_TOOLS.has(tool || ""))) bound.set(event.toolUseId, group); if (tool === "apply_fix") applying = group; }
    else if (event.type === "tool.use" && isSilent(event.name)) { hide(hidden, event); if (top && tool === "explain_action") explanation = explanationFrom(event); }
    else if (event.type === "tool.result" && event.toolUseId && hidden.has(event.toolUseId)) { const group = bound.get(event.toolUseId); if (group) group.result = event; }
    else if (event.type === "approval.requested" && (explanation || event.fix)) {
      const group: Extract<ThreadGroup, { kind: "approval" }> = { kind: "approval", event, explanation, decided: null };
      const waiting = event.fix && applying && !applying.result ? groups.indexOf(applying) : -1;
      if (waiting >= 0) groups.splice(waiting, 1);
      groups.push(group);
      if (waiting >= 0 && applying) groups.push(applying);
      if (event.inboxId) approvals.set(event.inboxId, group); explanation = null; applying = null;
    }
    else if (event.type === "approval.decided" && event.inboxId && approvals.has(event.inboxId)) { const group = approvals.get(event.inboxId)!; if (!group.decided || (!group.decided.actor && event.actor)) group.decided = event; }
    else if (STEP_TYPES.has(event.type)) {
      if (event.type === "tool.result" && top) explanation = null;
      const last = groups[groups.length - 1];
      if (last?.kind === "steps") last.events.push(event); else groups.push({ kind: "steps", events: [event], live: false });
    }
  }
  const last = groups[groups.length - 1];
  if (last?.kind === "steps" && taskLive) last.live = true;
  return groups;
}

/** The first and last events a group covers, for anchors and timings. */
export const firstEvent = (group: ThreadGroup): TaskEvent | undefined => ("events" in group ? group.events[0] : group.event);
export const lastEvent = (group: ThreadGroup): TaskEvent | undefined => ("events" in group ? group.events[group.events.length - 1] : group.event);

function hide(hidden: Set<string>, event: TaskEvent) { if (event.toolUseId) hidden.add(event.toolUseId); }

/** "Last 7 days · Veltrix, Corvana": the answers in question order, for the settled prompt, the rail and the Inbox. */
export function answerSummary(answers?: QuestionAnswers | null, questions?: QuestionSpec[] | null): string {
  if (!answers) return "";
  const ordered = questions?.length ? questions.map((question) => answers[question.question]).filter((value): value is string => Boolean(value && value.trim())) : Object.values(answers).filter((value) => value && value.trim());
  return ordered.join(" · ");
}

export function safeParse(value?: string): Record<string, unknown> | null { if (!value) return null; try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" ? parsed : null; } catch { return null; } }

/** Files the agent wrote, taken from the event stream. */
export function artifactsFrom(events: TaskEvent[]): Array<{ path: string; name: string; at: string }> {
  const seen = new Map<string, { path: string; name: string; at: string }>();
  for (const event of events) {
    if (event.type !== "tool.use" || !isFileWrite(event.name)) continue;
    const input = safeParse(event.input); const path = String(input?.file_path || input?.path || input?.notebook_path || ""); if (!path) continue;
    seen.set(path, { path, name: path.split(/[\\/]/).pop() || path, at: event.at });
  }
  return [...seen.values()];
}

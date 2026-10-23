import type { TaskEvent } from "@/api/tasks";
import { isNervecenterWrite, nervecenterTool, stepLabel } from "./stepLabels";
import { safeParse } from "./taskEvents";

/** The agent's writes and their reasons, for the approval card and the Details sheet's Changes. Pure. */

/** "The repair run succeeded." reads as "because the repair run succeeded" under the change. */
export function becauseOf(reason?: string | null): string | null {
  const text = (reason || "").trim().replace(/[.。]+$/, "");
  if (!text) return null;
  const lower = /^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
  return /^because\b/i.test(lower) ? lower : `because ${lower}`;
}

/** The reason the agent gave on a write: on the approval event itself, or inside the tool input. */
export function reasonOf(event: Pick<TaskEvent, "reason" | "input" | "tool">): string | null {
  if (typeof event.reason === "string" && event.reason.trim()) return event.reason.trim();
  const input = safeParse(event.input) || safeParse(event.tool?.input);
  return typeof input?.reason === "string" && input.reason.trim() ? input.reason.trim() : null;
}

/** One NerveCenter write the agent made, for the Changes rail: what, why, when, and the ticket it touched. */
export interface ChangeRow { id: string; seq: number; at: string; tool: string; text: string; reason: string | null; ticketId: string | null; failed: boolean }

export function writeChanges(events: TaskEvent[]): ChangeRow[] {
  const rows: ChangeRow[] = [];
  const byToolUse = new Map<string, ChangeRow>();
  for (const event of events) {
    if (event.type === "tool.result") { const row = event.toolUseId ? byToolUse.get(event.toolUseId) : undefined; if (row && event.isError) row.failed = true; continue; }
    if (event.type !== "tool.use" || !isNervecenterWrite(event.name)) continue;
    const input = safeParse(event.input);
    const row: ChangeRow = { id: event.id, seq: event.seq, at: event.at, tool: nervecenterTool(event.name) || "", text: stepLabel(event), reason: reasonOf(event), ticketId: typeof input?.ticketId === "string" && input.ticketId.trim() ? input.ticketId.trim() : null, failed: false };
    rows.push(row); if (event.toolUseId) byToolUse.set(event.toolUseId, row);
  }
  return rows;
}

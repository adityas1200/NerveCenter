import type { TaskEvent } from "@/api/tasks";
import { knowledgePlace } from "./stepLabels";
import { safeParse, type ThreadGroup } from "./taskEvents";

/** Saved corrections in a turn (SPEC-knowledge-05 FR-5), for the "Saved for review" card. */

const KNOWLEDGE_TOOL = "mcp__nervecenter__update_knowledge";
const TAUGHT = new Set(["correction", "interview"]);

export interface TeachMoment { id: string; title: string; base: string; path: string; taughtBy: string | null; fields: Record<string, string | string[]>; excerpt: string | null; link: string }

/** The first line of what was saved, without markdown marks and not the title again, for a card with no fields to show. */
const firstLine = (content: unknown, title: string) => String(content || "").split(/\r?\n/).map((line) => line.replace(/^[#>*\-\s]+/, "").trim()).find((line) => line && line.toLowerCase() !== title.toLowerCase())?.slice(0, 160) || null;

/** The saved corrections in a turn's steps: an update_knowledge call with origin correction or interview that saved. */
export function teachMomentsFrom(groups: ThreadGroup[]): TeachMoment[] {
  const uses = new Map<string, TaskEvent>();
  const out: TeachMoment[] = [];
  for (const group of groups) {
    if (group.kind !== "steps") continue;
    for (const event of group.events) {
      if (event.type === "tool.use" && event.name === KNOWLEDGE_TOOL && event.toolUseId) uses.set(event.toolUseId, event);
      if (event.type !== "tool.result" || event.isError || !event.toolUseId) continue;
      const use = uses.get(event.toolUseId);
      if (!use) continue;
      const input = safeParse(use.input) || {};
      const output = safeParse(event.content);
      if (!output?.saved || !TAUGHT.has(String(output.origin || input.origin || ""))) continue;
      const title = String(output.title || input.title || knowledgePlace(output.path));
      out.push({
        id: event.toolUseId,
        title,
        base: String(output.base || input.base || ""),
        path: String(output.path || input.path || ""),
        taughtBy: typeof output.taughtBy === "string" ? output.taughtBy : typeof input.taughtBy === "string" ? input.taughtBy : null,
        fields: (output.fields && typeof output.fields === "object" ? output.fields : {}) as Record<string, string | string[]>,
        excerpt: firstLine(input.content, title),
        link: typeof output.link === "string" ? output.link : `/knowledge/${encodeURIComponent(String(output.base || ""))}`,
      });
    }
  }
  return out;
}

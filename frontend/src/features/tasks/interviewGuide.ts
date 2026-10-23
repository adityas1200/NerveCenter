import type { GuideQuestion, GuideStatus, InterviewGuide } from "@/api/tasks";

/**
 * The interview guide of a knowledge setup task (SPEC-knowledge-03 FR-8): questions grouped by theme, the counts by
 * status, and the Markdown the build lead takes into the meeting. Pure, so the panel and its tests share it.
 */

export const GUIDE_STATUS_LABEL: Record<GuideStatus, string> = { open: "Open", answered: "Answered", partly: "Partly", not_discussed: "Not discussed", dropped: "Dropped" };
const STATUS_ORDER: GuideStatus[] = ["open", "partly", "answered", "not_discussed", "dropped"];
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 } as const;
const idNumber = (id: string) => Number(id.replace(/^G-/, "")) || 0;

/** "14 open · 9 answered · 3 partly": only the statuses that have questions, open first. */
export function guideCounts(questions: GuideQuestion[]): Array<{ status: GuideStatus; count: number }> {
  return STATUS_ORDER.map((status) => ({ status, count: questions.filter((item) => item.status === status).length })).filter((item) => item.count > 0);
}

/** Themes in order of their most urgent question, each with its questions high priority first, then by id. */
export function groupGuide(questions: GuideQuestion[], openOnly = false): Array<{ theme: string; questions: GuideQuestion[] }> {
  const shown = openOnly ? questions.filter((item) => item.status === "open" || item.status === "partly") : questions;
  const byTheme = new Map<string, GuideQuestion[]>();
  for (const item of shown) byTheme.set(item.theme, [...(byTheme.get(item.theme) ?? []), item]);
  const order = (a: GuideQuestion, b: GuideQuestion) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || idNumber(a.id) - idNumber(b.id);
  return [...byTheme.entries()]
    .map(([theme, items]) => ({ theme, questions: [...items].sort(order) }))
    .sort((a, b) => order(a.questions[0], b.questions[0]));
}

/** An evidence link as the facilitator can open it from a document: app paths become full links on this origin. */
const linkFor = (href: string | undefined, origin: string) => (!href ? "" : href.startsWith("/") ? `${origin}${href}` : href);

/**
 * The guide to take into the interview (FR-8): the questions still to ask (open and partly answered), grouped by
 * theme, each with its id to say aloud, who is likely to know, why it is asked and the evidence behind it.
 */
export function guideMarkdown(guide: InterviewGuide, { title = "Interview guide", origin = "" }: { title?: string; origin?: string } = {}): string {
  const groups = groupGuide(guide.questions, true);
  const lines = [`# ${title}`, "", "Say each question's id aloud (for example \"G-7\") before you ask it, so the transcript can be matched to it.", ""];
  if (!groups.length) lines.push("No open questions.", "");
  for (const group of groups) {
    lines.push(`## ${group.theme}`, "");
    for (const item of group.questions) {
      const meta = [item.priority === "high" ? "high priority" : null, item.audience ? `ask: ${item.audience}` : null, item.round > 1 ? `round ${item.round}` : null, item.status === "partly" ? "partly answered" : null].filter(Boolean).join(" · ");
      lines.push(`**${item.id}**${meta ? ` · ${meta}` : ""}`, "", item.question, "");
      if (item.why) lines.push(`- Why: ${item.why}`);
      for (const evidence of item.evidence) lines.push(`- Evidence: ${evidence.label}${evidence.href ? ` (${linkFor(evidence.href, origin)})` : ""}`);
      if (item.status === "partly" && item.answer) lines.push(`- So far: ${item.answer}`);
      lines.push("");
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

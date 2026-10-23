/**
 * Plain words for a skill. Folder names become titles (rca → RCA, failure-summary → Failure summary)
 * and the SKILL.md description is split into what the skill does and when the agent reaches for it,
 * which the description states in its "Use for / Use when …" sentences.
 */

import { capitalise } from "@/lib/utils";

const ACRONYMS: Record<string, string> = { rca: "RCA", dq: "DQ", sql: "SQL", api: "API", mcp: "MCP", okf: "OKF", sla: "SLA", etl: "ETL", ci: "CI", cd: "CD", pr: "PR", hr: "HR", kpi: "KPI", ui: "UI", id: "ID" };

export function skillDisplayName(name: string): string {
  const words = name.replace(/^[^:]+:/, "").split(/[-_\s]+/).filter(Boolean);
  return words.map((word, index) => ACRONYMS[word.toLowerCase()] ?? (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word)).join(" ");
}

const USE_SENTENCE = /^use\s+(for|when|whenever|after|before|during|with|to|on|if)\b\s*/i;

export function splitDescription(description: string): { what: string; when: string } {
  // A sentence ends at . ! or ? followed by a space, so "operations.yaml" stays whole.
  const sentences = description.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean);
  const what: string[] = []; const when: string[] = [];
  for (const sentence of sentences) {
    const use = USE_SENTENCE.exec(sentence);
    if (!use) { (when.length ? when : what).push(sentence); continue; }
    const rest = sentence.slice(use[0].length);
    const lead = use[1].toLowerCase();
    // "Use for failed jobs" → "Failed jobs"; "Use when an RCA finds" → "When an RCA finds"; "Also use when" is covered by the next sentence form.
    when.push(lead === "for" || lead === "with" || lead === "on" ? capitalise(rest) : `${capitalise(lead)} ${rest}`);
  }
  // "Also use when…" sentences read naturally without the "Also use".
  return { what: what.join(" "), when: when.map((sentence) => sentence.replace(/^Also use\s+/i, "")).map(capitalise).join(" ") };
}


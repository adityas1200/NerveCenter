import type { TaskEvent } from "@/api/tasks";
import type { Investigation } from "./investigation";
import { nervecenterTool } from "./stepLabels";
import { safeParse } from "./taskEvents";
import { skillSlug } from "./tools";

/**
 * The skills and knowledge a task drew on, from the event stream. The agent often follows a skill by
 * reading its files rather than calling the Skill tool, so a read of `skills/<name>/SKILL.md` (or its
 * references and assets) counts as using that skill. Knowledge is every `search_knowledge` query, every
 * page read under `knowledge/`, and every knowledge page the investigation cited.
 */

export interface SkillUse { name: string; uses: number; firstSeq: number }
export interface KnowledgeSearch { query: string; firstSeq: number }
export interface KnowledgeDoc { path: string; name: string; reads: number; cited: boolean; firstSeq: number | null }
export interface KnowledgeUse { searches: KnowledgeSearch[]; docs: KnowledgeDoc[] }

const SKILL_FILE = /(?:^|\/)skills\/([^/]+)\/(?:SKILL\.md$|references\/|assets\/)/i;
const KNOWLEDGE_FILE = /^(?:.*?\/)?knowledge\/(.+)$/i;

const slashes = (value: string) => value.replace(/\\/g, "/");

export function skillFromPath(path: string): string | null {
  return SKILL_FILE.exec(slashes(path))?.[1] ?? null;
}

/** The page's path inside the knowledge folder, or null when the file is not a knowledge page. */
export function knowledgePathOf(path: string): string | null {
  const normal = slashes(path);
  if (!normal || skillFromPath(normal)) return null;
  return KNOWLEDGE_FILE.exec(normal)?.[1] ?? null;
}

const readTarget = (event: TaskEvent): string | null => {
  if (event.type !== "tool.use" || event.name !== "Read") return null;
  const input = safeParse(event.input);
  return String(input?.file_path || input?.path || "") || null;
};

export function skillUsage(events: TaskEvent[]): SkillUse[] {
  const byName = new Map<string, SkillUse>();
  const add = (name: string, seq: number) => { const found = byName.get(name); if (found) found.uses += 1; else byName.set(name, { name, uses: 1, firstSeq: seq }); };
  for (const event of events) {
    if (event.type !== "tool.use") continue;
    if (event.name === "Skill") { const input = safeParse(event.input); const name = skillSlug(input); if (name) add(name, event.seq); continue; }
    const target = readTarget(event);
    const name = target ? skillFromPath(target) : null;
    if (name) add(name, event.seq);
  }
  return [...byName.values()];
}

export function skillsUsed(events: TaskEvent[]): string[] { return skillUsage(events).map((skill) => skill.name); }

const NAMED_PROJECT_SKILLS = 3;

/** "4 skills" from a session.init event, naming the project's own skills so an uploaded pack is visible (SPEC-tasks-08 FR-2). */
export function availableSkillsLabel(event: TaskEvent, noun = "skills"): string | null {
  const project = event.projectSkills ?? [];
  const count = (event.skills?.length ?? 0) + project.length;
  if (!count) return null;
  const named = project.slice(0, NAMED_PROJECT_SKILLS).join(", ");
  const more = project.length > NAMED_PROJECT_SKILLS ? ` and ${project.length - NAMED_PROJECT_SKILLS} more` : "";
  return `${count} ${noun}${project.length ? `, including ${named}${more}` : ""}`;
}

export function knowledgeUsage(events: TaskEvent[], investigation?: Investigation | null): KnowledgeUse {
  const searches: KnowledgeSearch[] = [];
  const seenQueries = new Set<string>();
  const docs = new Map<string, KnowledgeDoc>();
  const doc = (path: string): KnowledgeDoc => {
    let found = docs.get(path.toLowerCase());
    if (!found) { found = { path, name: path.split("/").pop() || path, reads: 0, cited: false, firstSeq: null }; docs.set(path.toLowerCase(), found); }
    return found;
  };
  for (const event of events) {
    if (event.type !== "tool.use") continue;
    if (nervecenterTool(event.name) === "search_knowledge") {
      const query = String(safeParse(event.input)?.query || "").trim();
      if (query && !seenQueries.has(query.toLowerCase())) { seenQueries.add(query.toLowerCase()); searches.push({ query, firstSeq: event.seq }); }
      continue;
    }
    const target = readTarget(event);
    const path = target ? knowledgePathOf(target) : null;
    if (!path) continue;
    const found = doc(path);
    found.reads += 1;
    if (found.firstSeq === null) found.firstSeq = event.seq;
  }
  for (const ref of citedKnowledge(investigation)) {
    const path = slashes(ref).replace(/^knowledge\//i, "");
    const match = [...docs.values()].find((item) => item.path.toLowerCase() === path.toLowerCase() || item.path.toLowerCase().endsWith(`/${path.toLowerCase()}`));
    (match ?? doc(path)).cited = true;
  }
  return { searches, docs: [...docs.values()] };
}

function citedKnowledge(investigation?: Investigation | null): string[] {
  if (!investigation) return [];
  const findings = [...investigation.hypotheses.flatMap((hypothesis) => [hypothesis, ...hypothesis.evidence]), ...investigation.looseEvidence, ...(investigation.rootCause ? [investigation.rootCause] : []), ...investigation.fixes, ...investigation.verifications, ...(investigation.inconclusive ? [investigation.inconclusive] : [])];
  return findings.flatMap((finding) => finding.refs).filter((ref) => ref.kind === "knowledge" && ref.ref).map((ref) => ref.ref as string);
}

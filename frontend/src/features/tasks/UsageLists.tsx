import { BookOpen, Search, Puzzle } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { evidenceTarget } from "./investigation";
import type { KnowledgeUse, SkillUse } from "./taskUsage";

/** The skills and knowledge a task drew on, for the rail. Each skill jumps to its first use; each page opens in Knowledge. */

const ROW = "flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors";

export function SkillsList({ skills, onSelect }: { skills: SkillUse[]; onSelect?: (firstSeq: number) => void }) {
  if (!skills.length) return <p className="text-[13px] text-ink-5">No skills used yet</p>;
  return (
    <ol className="space-y-0.5">
      {skills.map((skill) => (
        <li key={skill.name}>
          <button type="button" disabled={!onSelect} onClick={() => onSelect?.(skill.firstSeq)} className={cn(ROW, "enabled:hover:bg-surface-subtle")}>
            <Puzzle className="mt-[3px] h-3.5 w-3.5 shrink-0 text-ink-4" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] leading-5 text-ink-2">{skill.name}</span>
              <span className="block text-[12.5px] leading-4 text-ink-5">Used {skill.uses} {skill.uses === 1 ? "time" : "times"}</span>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

export function KnowledgeList({ knowledge, onSelect }: { knowledge: KnowledgeUse; onSelect?: (firstSeq: number) => void }) {
  const { searches, docs } = knowledge;
  if (!searches.length && !docs.length) return <p className="text-[13px] text-ink-5">No knowledge used yet</p>;
  return (
    <div className="space-y-4">
      {docs.length ? (
        <section>
          <h3 className="px-2 text-[12px] font-medium text-ink-5">Pages</h3>
          <ol className="mt-1 space-y-0.5">
            {docs.map((doc) => {
              const target = evidenceTarget({ label: doc.name, kind: "knowledge", ref: doc.path });
              const folder = doc.path.includes("/") ? doc.path.slice(0, doc.path.lastIndexOf("/")) : null;
              const body = (
                <>
                  <BookOpen className="mt-[3px] h-3.5 w-3.5 shrink-0 text-ink-4" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[13.5px] leading-5 text-ink-2" title={doc.path}>{doc.name}</span>
                      {doc.cited ? <span className="shrink-0 rounded-md border border-line bg-surface-subtle px-1.5 py-px text-[11px] font-medium text-ink-4">Cited</span> : null}
                    </span>
                    <span className="block truncate text-[12.5px] leading-4 text-ink-5">{[folder, doc.reads ? `Read ${doc.reads} ${doc.reads === 1 ? "time" : "times"}` : "Cited, not read"].filter(Boolean).join(" · ")}</span>
                  </span>
                </>
              );
              return <li key={doc.path}>{target.type === "route" ? <Link to={target.to} className={cn(ROW, "hover:bg-surface-subtle")}>{body}</Link> : <div className={ROW}>{body}</div>}</li>;
            })}
          </ol>
        </section>
      ) : null}
      {searches.length ? (
        <section>
          <h3 className="px-2 text-[12px] font-medium text-ink-5">Searches</h3>
          <ol className="mt-1 space-y-0.5">
            {searches.map((search) => (
              <li key={search.query}>
                <button type="button" disabled={!onSelect} onClick={() => onSelect?.(search.firstSeq)} className={cn(ROW, "enabled:hover:bg-surface-subtle")}>
                  <Search className="mt-[3px] h-3.5 w-3.5 shrink-0 text-ink-4" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-[13.5px] leading-5 text-ink-2" title={search.query}>{search.query}</span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

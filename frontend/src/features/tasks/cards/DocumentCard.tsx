import { FileSpreadsheet, FileText, Presentation, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { AgentCard } from "./AgentCard";
import type { Block } from "./blocks";
import { StateTag } from "./DataBlocks";
import { useTaskActions } from "./taskActions";

type Doc = Extract<Block, { kind: "document" }>;
const ICON: Record<Doc["format"], LucideIcon> = { document: FileText, deck: Presentation, sheet: FileSpreadsheet, pdf: FileText, report: FileText, other: FileText };
const WORD: Record<Doc["format"], string> = { document: "Document", deck: "Deck", sheet: "Workbook", pdf: "PDF", report: "Report", other: "File" };
const SECTION: Record<"done" | "draft" | "todo", { tone: "good" | "warning" | "neutral"; word: string }> = { done: { tone: "good", word: "Done" }, draft: { tone: "warning", word: "Draft" }, todo: { tone: "neutral", word: "To do" } };

/** A file in the task folder with its outline, so a reader sees what a deck or brief holds before opening it. */
export function DocumentCard({ block, compact = false, className }: { block: Doc; compact?: boolean; className?: string }) {
  const actions = useTaskActions();
  const Icon = ICON[block.format];
  const name = block.path ? block.path.split(/[\\/]/).pop() : null;
  return (
    <AgentCard title={block.title} note={[WORD[block.format], name].filter(Boolean).join(" · ")} compact={compact} className={className} action={block.path && actions.openFile ? <Button size="xs" variant="outline" className="border border-line bg-raised" onClick={() => actions.openFile?.(block.path || "")}>Open</Button> : null}>
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-panel text-ink-3" aria-hidden="true"><Icon className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          {block.summary ? <p className="text-[13.5px] leading-6 text-ink-2">{block.summary}</p> : null}
          {block.outline.length ? (
            <ol className={cn("divide-y divide-line-soft", block.summary && "mt-2")}>
              {block.outline.map((section, index) => (
                <li key={`${section.heading}-${index}`} className="flex items-center gap-3 py-1.5 text-[13px]">
                  <span className="w-5 shrink-0 text-right tabular-nums text-ink-5">{index + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-ink-2" title={section.heading}>{section.heading}</span>
                  {section.status ? <StateTag tone={SECTION[section.status].tone}>{SECTION[section.status].word}</StateTag> : null}
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      </div>
    </AgentCard>
  );
}

import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { AgentCard } from "./AgentCard";
import type { Card, ChangeTesting } from "./cards";

/**
 * A change Sonic made or proposes, reviewable in place: what it does, how it was tested and with what
 * result, and each file's diff. Added lines are green, removed lines red; nothing else is coloured.
 */

const STATE_WORD = { proposed: "Proposed", applied: "Applied", reverted: "Reverted" } as const;
const TEST_TONE: Record<ChangeTesting["result"], string> = { passed: "border-emerald-300 text-emerald-700", failed: "border-rose-300 text-rose-700", inconclusive: "border-amber-300 text-amber-800", not_tested: "border-line text-ink-4" };
const TEST_WORD: Record<ChangeTesting["result"], string> = { passed: "Passed", failed: "Failed", inconclusive: "Inconclusive", not_tested: "Not tested" };

export function ChangeCard({ card, compact = false, className }: { card: Extract<Card, { kind: "change" }>; compact?: boolean; className?: string }) {
  const additions = card.files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = card.files.reduce((sum, file) => sum + file.deletions, 0);
  return (
    <AgentCard title={card.title} compact={compact} className={className}
      note={`${STATE_WORD[card.state]} · ${card.files.length} ${card.files.length === 1 ? "file" : "files"}`}
      action={card.link ? <a href={card.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-brand hover:text-brand-hover">Open<ExternalLink className="h-3 w-3" aria-hidden="true" /></a> : undefined}>
      {card.summary ? <p className="text-[13.5px] leading-5 text-ink-2">{card.summary}</p> : null}
      {card.testing ? (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-ink-3">
          <span className={cn("rounded-md border px-1.5 py-px text-[11.5px] font-semibold", TEST_TONE[card.testing.result])}>{TEST_WORD[card.testing.result]}</span>
          <span className="text-ink-2">{card.testing.method}</span>
          {card.testing.detail ? <span className="text-ink-4">· {card.testing.detail}</span> : null}
        </p>
      ) : null}
      <p className="mt-2 text-[12px] tabular-nums text-ink-4"><span className="text-emerald-700">+{additions}</span> <span className="text-rose-700">−{deletions}</span></p>
      <div className="mt-1.5 space-y-2">
        {card.files.map((file, index) => (
          <details key={`${file.path}-${index}`} open={index === 0} className="overflow-hidden rounded-lg border border-line">
            <summary className="flex cursor-pointer select-none items-center gap-2 bg-surface-subtle px-2.5 py-1.5 text-[12.5px]">
              <span className="min-w-0 flex-1 truncate font-mono text-ink-2">{file.path}</span>
              <span className="shrink-0 tabular-nums"><span className="text-emerald-700">+{file.additions}</span> <span className="text-rose-700">−{file.deletions}</span></span>
            </summary>
            <pre className="max-h-72 overflow-auto font-mono text-[12px] leading-[18px]">
              {file.diff.split("\n").map((line, lineIndex) => (
                <span key={lineIndex} className={cn("block px-2.5", line.startsWith("+") && !line.startsWith("+++") ? "bg-emerald-50 text-emerald-900" : line.startsWith("-") && !line.startsWith("---") ? "bg-rose-50 text-rose-900" : line.startsWith("@@") ? "text-ink-4" : "text-ink-2")}>{line || " "}</span>
              ))}
            </pre>
          </details>
        ))}
      </div>
    </AgentCard>
  );
}

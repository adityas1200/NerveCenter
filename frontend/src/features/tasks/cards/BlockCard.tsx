import { cn } from "@/lib/utils";
import { ActionsCard } from "./ActionsCard";
import type { Block, Component } from "./blocks";
import { PipelineRunsCard, TicketCard } from "./BoundCards";
import { ChartBlock, ChecklistBlock, FactsBlock, FlowBlock, GenericBlockCard, NotesBlock, ProgressBlock, RecordsBlock, SetDiffBlock, StatusGridBlock } from "./DataBlocks";
import { DocumentCard } from "./DocumentCard";
import { EmailCard } from "./EmailCard";
import { FixProposalCard, FixResultCard } from "./FixCards";
import { ResultCard } from "./ResultCard";
import { FunnelBlock, GanttBlock, GaugesBlock, HeatmapBlock } from "./VizBlocks";

/** One catalog block, whichever kind (SPEC-tasks-10 FR-16). A kind with no case here never reaches it: blocks.ts made it generic. */
export function BlockCard({ block, compact = false, taskId, className }: { block: Block; compact?: boolean; taskId?: string; className?: string }) {
  const props = { compact, className };
  switch (block.kind) {
    case "chart": return <ChartBlock block={block} {...props} />;
    case "facts": return <FactsBlock block={block} {...props} />;
    case "heatmap": return <HeatmapBlock block={block} {...props} />;
    case "gauges": return <GaugesBlock block={block} {...props} />;
    case "funnel": return <FunnelBlock block={block} {...props} />;
    case "gantt": return <GanttBlock block={block} {...props} />;
    case "status_grid": return <StatusGridBlock block={block} {...props} />;
    case "progress": return <ProgressBlock block={block} {...props} />;
    case "flow": return <FlowBlock block={block} {...props} />;
    case "set_diff": return <SetDiffBlock block={block} {...props} />;
    case "checklist": return <ChecklistBlock block={block} {...props} />;
    case "records": return <RecordsBlock block={block} {...props} />;
    case "notes": return <NotesBlock block={block} {...props} />;
    case "email": return <EmailCard block={block} {...props} />;
    case "document": return <DocumentCard block={block} {...props} />;
    case "actions": return <ActionsCard block={block} {...props} />;
    case "view": return <ViewCard block={block} taskId={taskId} {...props} />;
    case "ticket": return <TicketCard block={block} {...props} />;
    case "pipeline_runs": return <PipelineRunsCard block={block} {...props} />;
    case "fix_proposal": return <FixProposalCard block={block} {...props} />;
    case "fix_result": return <FixResultCard block={block} {...props} />;
    default: return <GenericBlockCard block={block} {...props} />;
  }
}

/** A drawn component from either family: the first cards (cards.ts) or the catalog blocks. */
export function ComponentView({ component, compact = false, taskId, className }: { component: Component; compact?: boolean; taskId?: string; className?: string }) {
  return component.type === "card" ? <ResultCard card={component.card} compact={compact} taskId={taskId} className={className} /> : <BlockCard block={component.block} compact={compact} taskId={taskId} className={className} />;
}

/**
 * A composed view: a title over its blocks laid out in order, half-width blocks side by side (FR-13). The
 * view itself has no frame, so its blocks are not cards inside a card. One column in the compact panel.
 */
function ViewCard({ block, compact, taskId, className }: { block: Extract<Block, { kind: "view" }>; compact: boolean; taskId?: string; className?: string }) {
  return (
    <section className={cn("min-w-0", className)} aria-label={block.title}>
      <header className="mb-3">
        <h3 className={cn("font-semibold text-ink-1", compact ? "text-[14px]" : "text-[16px]")}>{block.title}</h3>
        {block.summary ? <p className="mt-0.5 text-[13.5px] leading-5 text-ink-3">{block.summary}</p> : null}
      </header>
      <div className={cn("grid gap-3", !compact && "sm:grid-cols-2")}>
        {block.blocks.map((child, index) => <ComponentView key={index} component={child.item} compact={compact} taskId={taskId} className={cn(child.width === "full" && "sm:col-span-2")} />)}
      </div>
    </section>
  );
}

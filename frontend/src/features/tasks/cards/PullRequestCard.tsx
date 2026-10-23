import { ArrowRight, ExternalLink, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { AgentCard } from "./AgentCard";
import type { Card, PullRequestState } from "./cards";

/**
 * A pull request the agent opened: GitHub's state colours and icon, the title and number, head → base
 * branches in mono, the change size, the ticket it fixes, and one button to review it on GitHub.
 */

const STATE: Record<PullRequestState, { label: string; icon: typeof GitPullRequest; pill: string; tile: string }> = {
  open: { label: "Open", icon: GitPullRequest, pill: "border-emerald-200 bg-emerald-50 text-emerald-700", tile: "bg-emerald-600 text-white" },
  draft: { label: "Draft", icon: GitPullRequestDraft, pill: "border-line-strong bg-surface-subtle text-ink-3", tile: "bg-ink-4 text-white" },
  merged: { label: "Merged", icon: GitMerge, pill: "border-violet-200 bg-violet-50 text-violet-700", tile: "bg-violet-600 text-white" },
  closed: { label: "Closed", icon: GitPullRequestClosed, pill: "border-rose-200 bg-rose-50 text-rose-700", tile: "bg-rose-600 text-white" },
};

export function PullRequestCard({ card, compact = false, className }: { card: Extract<Card, { kind: "pull_request" }>; compact?: boolean; className?: string }) {
  const pr = card.pullRequest;
  const state = STATE[pr.state];
  const Icon = state.icon;
  return (
    <AgentCard
      title="Pull request"
      compact={compact}
      className={className}
      action={<span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] font-medium", state.pill)}><Icon className="h-3.5 w-3.5" aria-hidden="true" />{state.label}</span>}
    >
      <div className="flex items-start gap-3">
        <span className={cn("mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg shadow-sm", state.tile, compact && "h-8 w-8")} aria-hidden="true"><Icon className="h-[18px] w-[18px]" /></span>
        <div className="min-w-0 flex-1">
          <p className={cn("font-medium leading-6 text-ink-1", compact ? "text-[14px]" : "text-[15px]")}>
            {card.title} <span className="font-normal text-ink-4">#{pr.number}</span>
          </p>
          <p className="truncate text-[12.5px] text-ink-4" title={pr.repository}>{pr.repository}</p>
          <p className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5 font-mono text-[12px]" aria-label={`Merges ${pr.branch} into ${pr.base}`}>
            <span className="max-w-full truncate rounded bg-brand/10 px-1.5 py-0.5 text-brand" title={pr.branch}>{pr.branch}</span>
            <ArrowRight className="h-3 w-3 shrink-0 text-ink-5" aria-hidden="true" />
            <span className="rounded bg-surface-subtle px-1.5 py-0.5 text-ink-3">{pr.base}</span>
          </p>
          {card.note ? <p className={cn("mt-2 text-ink-2", compact ? "text-[13px] leading-5" : "text-[13.5px] leading-6")}>{card.note}</p> : null}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-3 text-[12.5px] text-ink-4">
        {pr.additions !== null ? <span className="font-mono font-medium text-emerald-700">+{pr.additions}</span> : null}
        {pr.deletions !== null ? <span className="font-mono font-medium text-rose-700">−{pr.deletions}</span> : null}
        {pr.files !== null ? <span>{pr.files} {pr.files === 1 ? "file" : "files"}</span> : null}
        {pr.ticketId ? <span>Fixes <Link to={`/tickets/${encodeURIComponent(pr.ticketId)}`} className="font-medium text-ink-1 underline decoration-line-strong underline-offset-2 hover:decoration-ink-3">{pr.ticketId}</Link></span> : null}
        <a
          href={pr.url}
          target="_blank"
          rel="noreferrer"
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-ink-1 px-3 py-1.5 text-[12.5px] font-medium text-raised shadow-sm transition-colors hover:bg-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          Review on GitHub<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      </div>
    </AgentCard>
  );
}

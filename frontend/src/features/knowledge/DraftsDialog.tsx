import { refreshAfterWrite } from "@/lib/refreshAfterWrite";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { knowledgeApi, knowledgeKeys, type KnowledgeDraft, type KnowledgeOrigin, type KnowledgeProposal } from "@/api/library";
import { AGENT_NAME } from "@/components/ops/agentPanelContext";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, formatRelativeTime, useToast, confirmAction } from "@/components/ui";
import { knowledgePlace } from "@/features/tasks/stepLabels";
import { cn } from "@/lib/utils";
import { useAction } from "@/lib/useAction";

/**
 * The lessons the agent saved in a knowledge base, waiting for a person. Each shows where it went,
 * why the agent put it there, the ticket it came from and exactly what changed. Admins keep it
 * (committed under their name, a new page linked from the index) or discard it (the page goes
 * back to its last kept version). Others can read the drafts but not decide. In a Git base reviewed by
 * pull request, keeping proposes: the drafts go to a branch and a pull request the base's reviewers
 * merge, and they count as knowledge after that.
 */
export function DraftsDialog({ base, title, open, onOpenChange, canDecide, onOpenFile, review, proposals = [] }: { base: string; title: string; open: boolean; onOpenChange: (open: boolean) => void; canDecide: boolean; onOpenFile: (path: string) => void; review?: "pull_request" | "direct"; proposals?: KnowledgeProposal[] }) {
  const proposing = review === "pull_request";
  const toast = useToast();
  const queryClient = useQueryClient();
  const drafts = useQuery({ queryKey: knowledgeKeys.drafts(base), queryFn: ({ signal }) => knowledgeApi.drafts(base, signal), enabled: open });
  const refresh = async () => { await Promise.all([refreshAfterWrite(queryClient, { queryKey: knowledgeKeys.all })]); };
  const keep = useMutation({
    mutationFn: (path: string | null) => knowledgeApi.keepDraft(base, path),
    onSuccess: async (result) => {
      await refresh();
      if (result.pushed === false) toast.error(result.review ? "Not proposed" : "Kept, not pushed", result.pushError || "The repository refused the push. Sync waits until it is pushed.");
      else if (result.review === "pull_request") toast.success("Proposed for review", result.pullRequest?.number ? `Pull request #${result.pullRequest.number} waits for the knowledge base's reviewers. It counts once it is merged.` : `Branch ${result.branch} is pushed; ${result.pullRequestError ? "open its pull request from the link under the drafts." : "it counts once it is merged."}`);
      else toast.success(result.kept.length === 1 ? "Draft kept" : `${result.kept.length} drafts kept`, "It is now part of the knowledge base.");
    },
    onError: (error) => toast.error("Not kept", error instanceof Error ? error.message : "Try again."),
  });
  const discard = useAction({
    mutationFn: (path: string | null) => knowledgeApi.discardDraft(base, path),
    invalidate: [knowledgeKeys.all],
    success: (result) => (result.discarded.length === 1 ? "Draft discarded" : `${result.discarded.length} drafts discarded`),
    error: "Not discarded",
  });
  const items = drafts.data?.items ?? [];
  const busy = keep.isPending || discard.isPending;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-hidden p-0">
        <div className="flex max-h-[85vh] flex-col">
          <DialogHeader className="border-b border-line px-6 pb-4 pt-6">
            <DialogTitle>Drafts to review · {title}</DialogTitle>
            <DialogDescription>What {AGENT_NAME} learned from verified work, corrections, documents and the weekly pass. Nothing here is treated as approved knowledge until {proposing ? "a reviewer merges the pull request it goes into" : "someone keeps it"}.</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
            {drafts.isPending ? <p className="text-[13.5px] text-ink-4">Loading drafts…</p>
              : drafts.error ? <p className="text-[13.5px] text-rose-700">{drafts.error instanceof Error ? drafts.error.message : "Could not load the drafts."}</p>
              : !items.length ? <p className="text-[13.5px] text-ink-4">No drafts to review.</p>
              : items.map((draft) => (
                <DraftRow key={draft.path} draft={draft} canDecide={canDecide} busy={busy}
                  onOpen={() => { onOpenFile(draft.path); onOpenChange(false); }}
                  keepLabel={proposing ? "Propose" : "Keep"} onKeep={() => keep.mutate(draft.path)}
                  onDiscard={() => { void confirmAction({ title: "Discard this draft?", description: `${draft.path}: ${draft.change === "added" ? "the page is removed." : "the page goes back to its last kept version."}`, confirmLabel: "Discard draft", destructive: true }).then((ok) => { if (ok) discard.mutate(draft.path); }); }} />
              ))}
          </div>
          <DialogFooter className="border-t border-line px-6 py-3">
            {proposals.length ? <p className="mr-auto self-center truncate text-[12.5px] text-ink-4">Waiting for review: {proposals.slice(0, 3).map((proposal, index) => <span key={proposal.branch}>{index ? ", " : ""}{proposal.url ? <a href={proposal.url} target="_blank" rel="noreferrer" className="font-medium text-brand hover:text-brand-hover">{proposal.number ? `#${proposal.number}` : "open pull request"}</a> : proposal.branch}</span>)}</p> : null}
            {!canDecide && items.length && !proposals.length ? <p className="mr-auto self-center text-[12.5px] text-ink-4">An admin keeps or discards drafts.</p> : null}
            {canDecide && items.length > 1 ? <Button size="sm" variant="outline" className="border border-line" disabled={busy} onClick={() => keep.mutate(null)}>{proposing ? "Propose all" : "Keep all"} {items.length}</Button> : null}
            <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const CHANGE_LABEL: Record<KnowledgeDraft["change"], string> = { added: "New page", modified: "Added to page", deleted: "Page removed" };
/** Where a draft came from (SPEC-knowledge-05 FR-4). Drafts saved before origins existed get no label. */
const ORIGIN_LABEL: Record<KnowledgeOrigin, string> = { lesson: "Lesson", correction: "Correction", interview: "Interview", document: "From documents", pass: "Weekly pass", eval: "Eval case" };
const originLabel = (draft: KnowledgeDraft) => (draft.origin === "correction" && draft.taughtBy ? `Correction from ${draft.taughtBy}` : ORIGIN_LABEL[draft.origin!]);

function DraftRow({ draft, canDecide, busy, onOpen, onKeep, onDiscard, keepLabel = "Keep" }: { draft: KnowledgeDraft; canDecide: boolean; busy: boolean; onOpen: () => void; onKeep: () => void; onDiscard: () => void; keepLabel?: string }) {
  const place = knowledgePlace(draft.path);
  return (
    <article className="rounded-xl border border-line p-4" data-testid={`draft-${draft.path}`}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <button type="button" onClick={onOpen} className="min-w-0 truncate text-left text-[14.5px] font-semibold text-ink-1 hover:text-brand" title={draft.path}>{place}{draft.section && draft.change === "modified" ? ` › ${draft.section}` : ""}</button>
        <span className="rounded-full bg-amber-50 px-1.5 py-px text-[11px] font-medium text-amber-800 ring-1 ring-amber-200">{CHANGE_LABEL[draft.change]}</span>
        {draft.origin ? <span className="rounded-full bg-violet-50 px-1.5 py-px text-[11px] font-medium text-violet-700 ring-1 ring-violet-200">{originLabel(draft)}</span> : null}
      </div>
      <p className="mt-1 flex flex-wrap gap-x-1.5 text-[12.5px] text-ink-4">
        {draft.by === "agent" ? <span>By {AGENT_NAME}{draft.origin === "interview" && draft.taughtBy ? `, from ${draft.taughtBy}` : ""}</span> : <span>Uncommitted change</span>}
        {draft.sourceTicket ? <><span aria-hidden="true">·</span><span>from <Link to={`/tickets/${encodeURIComponent(draft.sourceTicket)}`} className="font-medium text-brand hover:text-brand-hover">{draft.sourceTicket}</Link></span></> : null}
        {draft.taskId ? <><span aria-hidden="true">·</span><Link to={`/tasks/${encodeURIComponent(draft.taskId)}`} className="font-medium text-brand hover:text-brand-hover">task {draft.taskId}</Link></> : null}
        {draft.at ? <><span aria-hidden="true">·</span><span>{formatRelativeTime(draft.at)}</span></> : null}
      </p>
      {draft.reason ? <p className="mt-2 text-[13.5px] leading-5 text-ink-2"><span className="text-ink-4">Why here: </span>{draft.reason}</p> : null}
      <DiffView diff={draft.diff} />
      {canDecide ? (
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="primary" disabled={busy} onClick={onKeep}>{keepLabel}</Button>
          <Button size="sm" variant="outline" className="border border-line" disabled={busy} onClick={onDiscard}>Discard</Button>
        </div>
      ) : null}
    </article>
  );
}

/** Only what changed: added lines green, removed lines red, a few lines of context; git's headers dropped. */
export function DiffView({ diff }: { diff: string }) {
  const lines = String(diff || "").split(/\r?\n/).filter((line) => !/^(diff --git|index |--- |\+\+\+ |new file mode|deleted file mode|\\ No newline)/.test(line));
  if (!lines.some((line) => line.trim())) return null;
  return (
    <pre className="mt-3 max-h-72 overflow-auto rounded-lg border border-line bg-surface-subtle py-2 font-mono text-[12px] leading-5" aria-label="What changed">
      {lines.map((line, index) => /^@@/.test(line)
        ? <span key={index} className="block px-3 text-ink-5">⋯</span>
        : <span key={index} className={cn("block whitespace-pre-wrap break-words px-3", line.startsWith("+") ? "bg-emerald-50 text-emerald-900" : line.startsWith("-") ? "bg-rose-50 text-rose-900 line-through decoration-rose-300" : "text-ink-4")}>{line || " "}</span>)}
    </pre>
  );
}

import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Download, ExternalLink, FileDiff } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useHref } from "react-router-dom";
import { knowledgeApi, knowledgeKeys } from "@/api/library";
import { tasksApi, type GuideQuestion, type GuideStatus, taskKeys } from "@/api/tasks";
import { AGENT_NAME } from "@/components/ops/agentPanelContext";
import { ErrorNotice } from "@/components/ops/ErrorNotice";
import { Badge, Button, Skeleton, Switch } from "@/components/ui";
import { cn } from "@/lib/utils";
import { GUIDE_STATUS_LABEL, groupGuide, guideCounts, guideMarkdown } from "./interviewGuide";

/**
 * The "Interview guide" tab of a knowledge setup task (SPEC-knowledge-03 FR-8, FR-11): the questions the build lead
 * takes into the team interviews, grouped by theme, and what each transcript settled. Sonic writes it; this only reads.
 * `version` changes when Sonic updates the guide, and `live` keeps it fresh while Sonic works.
 */

const STATUS_VARIANT: Record<GuideStatus, "secondary" | "emerald" | "amber"> = { open: "secondary", answered: "emerald", partly: "amber", not_discussed: "secondary", dropped: "secondary" };

export function InterviewGuidePanel({ taskId, base, live, version }: { taskId: string; base?: string; live: boolean; version: number }) {
  const [openOnly, setOpenOnly] = useState(false);
  const guide = useQuery({ queryKey: [...taskKeys.detail(taskId), "interview-guide", version], queryFn: ({ signal }) => tasksApi.interviewGuide(taskId, signal), refetchInterval: live ? 10_000 : false, placeholderData: (previous) => previous });
  const bases = useQuery({ queryKey: knowledgeKeys.all, queryFn: ({ signal }) => knowledgeApi.list(signal), enabled: Boolean(base) });
  const target = base ? bases.data?.items.find((item) => item.name === base) : undefined;
  const drafts = target?.pendingChanges ?? 0;
  // App paths in the file must open this project, so they carry the router's base (/p/<project>) as well as the origin.
  const appRoot = `${window.location.origin}${useHref("/").replace(/\/$/, "")}`;

  const download = () => {
    if (!guide.data) return;
    const blob = new Blob([guideMarkdown(guide.data, { title: target ? `Interview guide: ${target.title}` : "Interview guide", origin: appRoot })], { type: "text/markdown" });
    const url = URL.createObjectURL(blob); const link = document.createElement("a");
    link.href = url; link.download = "interview-guide.md"; link.click(); URL.revokeObjectURL(url);
  };

  if (guide.isPending) return <div className="space-y-2" aria-label="Loading the interview guide"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>;
  if (guide.error && !guide.data) return <ErrorNotice compact what="The interview guide did not load" why={guide.error instanceof Error ? guide.error.message : undefined} next={<Button size="sm" variant="outline" className="border border-line" onClick={() => void guide.refetch()}>Try again</Button>} />;
  const questions = guide.data?.questions ?? [];
  const groups = groupGuide(questions, openOnly);
  const toAsk = questions.filter((item) => item.status === "open" || item.status === "partly").length;

  return (
    <div className="space-y-4">
      {drafts && base ? (
        <Link to={`/knowledge/${encodeURIComponent(base)}?drafts=1`} className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-[13px] font-medium text-amber-800 transition-colors hover:border-amber-300">
          <FileDiff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1"><span className="tabular-nums">{drafts}</span> {drafts === 1 ? "draft" : "drafts"} in {target?.title || base} to review</span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        </Link>
      ) : null}
      {questions.length ? (
        <>
          <div className="space-y-2.5">
            <p className="text-[13px] text-ink-3" aria-label="Questions by status">{guideCounts(questions).map((item) => `${item.count} ${GUIDE_STATUS_LABEL[item.status].toLowerCase()}`).join(" · ")}</p>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2"><Switch id="guide-still-to-ask" checked={openOnly} onCheckedChange={setOpenOnly} aria-label="Show only questions still to ask" /><label htmlFor="guide-still-to-ask" className="text-[12.5px] font-medium text-ink-2">Still to ask</label></div>
              <Button size="sm" variant="outline" className="border border-line bg-raised" onClick={download} disabled={!toAsk} title={toAsk ? "The open questions as a Markdown file for the meeting" : "Every question is settled"}><Download className="h-3.5 w-3.5" aria-hidden="true" />Download</Button>
            </div>
          </div>
          {groups.length ? groups.map((group) => (
            <section key={group.theme} aria-label={group.theme}>
              <h3 className="text-[12px] font-semibold text-ink-4">{group.theme}</h3>
              <ul className="mt-1.5 space-y-1.5">{group.questions.map((item) => <li key={item.id}><QuestionRow item={item} /></li>)}</ul>
            </section>
          )) : <p className="text-[13px] text-ink-5">Every question is settled.</p>}
        </>
      ) : (
        <p className="text-[13px] leading-5 text-ink-5">No questions yet. {AGENT_NAME} adds them here as it finds what it cannot answer from the documents and systems.</p>
      )}
    </div>
  );
}

function QuestionRow({ item }: { item: GuideQuestion }) {
  const [open, setOpen] = useState(false);
  const settled = item.status === "dropped" || item.status === "not_discussed";
  return (
    <div className="rounded-lg border border-line bg-raised">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-start gap-2 px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/25">
        <span className="mt-0.5 shrink-0 font-mono text-[11.5px] text-ink-5">{item.id}</span>
        <span className={cn("min-w-0 flex-1 text-[13px] leading-5 text-ink-1", item.status === "dropped" && "text-ink-5 line-through", settled && item.status !== "dropped" && "text-ink-3")}>{item.question}</span>
        <ChevronRight className={cn("mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-5 transition-transform", open && "rotate-90")} aria-hidden="true" />
      </button>
      <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2.5 pl-[3.25rem]">
        <Badge variant={STATUS_VARIANT[item.status]} className="px-2 text-[11px]">{GUIDE_STATUS_LABEL[item.status]}</Badge>
        {item.priority === "high" ? <span className="text-[11.5px] font-semibold text-rose-700">High priority</span> : null}
        {item.audience ? <span className="truncate text-[11.5px] text-ink-4" title={item.audience}>Ask {item.audience}</span> : null}
        {item.round > 1 ? <span className="text-[11.5px] text-ink-5">Round {item.round}</span> : null}
      </div>
      {open ? (
        <dl className="space-y-2 border-t border-line px-3 py-2.5 text-[12.5px] leading-5">
          {item.why ? <Detail label="Why">{item.why}</Detail> : null}
          {item.evidence.length ? <Detail label="Evidence"><ul className="space-y-0.5">{item.evidence.map((evidence) => <li key={`${evidence.label}${evidence.href || ""}`}><EvidenceLink label={evidence.label} href={evidence.href} /></li>)}</ul></Detail> : null}
          {item.answer ? <Detail label="Answer">{item.answer}</Detail> : null}
          {item.cites.length ? <Detail label="Heard in"><ul className="space-y-0.5">{item.cites.map((cite) => <li key={`${cite.file}${cite.at || ""}${cite.speaker || ""}`} className="font-mono text-[11.5px] text-ink-3">{[cite.file, cite.at, cite.speaker].filter(Boolean).join(" · ")}</li>)}</ul></Detail> : null}
          {item.pages.length ? <Detail label="Knowledge"><ul className="space-y-0.5">{item.pages.map((page) => <li key={page}><Link className="break-all font-medium text-brand hover:text-brand-hover" to={`/knowledge?path=${encodeURIComponent(page)}`}>{page}</Link></li>)}</ul></Detail> : null}
          {!item.why && !item.evidence.length && !item.answer && !item.cites.length && !item.pages.length ? <p className="text-ink-5">Nothing more on this question yet.</p> : null}
        </dl>
      ) : null}
    </div>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt className="text-[11.5px] font-medium text-ink-5">{label}</dt><dd className="mt-0.5 text-ink-2">{children}</dd></div>;
}

/** App paths open in the app; anything else is an https link Sonic was allowed to save, opened in a new tab. */
function EvidenceLink({ label, href }: { label: string; href?: string }) {
  if (!href) return <span>{label}</span>;
  if (href.startsWith("/")) return <Link className="font-medium text-brand hover:text-brand-hover" to={href}>{label}</Link>;
  return <a className="inline-flex items-center gap-1 font-medium text-brand hover:text-brand-hover" href={href} target="_blank" rel="noreferrer">{label}<ExternalLink className="h-3 w-3" aria-hidden="true" /></a>;
}

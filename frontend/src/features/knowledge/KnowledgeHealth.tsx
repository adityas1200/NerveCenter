import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { knowledgeApi, knowledgeKeys, type Journey, type KnowledgeDigest, type KnowledgePass } from "@/api/library";
import { useCan } from "@/auth/rbac";
import { AGENT_NAME } from "@/components/ops/agentPanelContext";
import { AnimatedNumber } from "@/components/ops/AnimatedNumber";
import { Sparkline } from "@/components/ops/charts/Sparkline";
import { StatCell } from "@/components/ops/StatStrip";
import { SurfaceCard } from "@/components/ops/SurfaceCard";
import { Skeleton, Switch, formatRelativeTime } from "@/components/ui";
import { knowledgePlace } from "@/features/tasks/stepLabels";
import { cn } from "@/lib/utils";
import { useAction } from "@/lib/useAction";

/**
 * How well the knowledge works (SPEC-knowledge-06 FR-8) and what the weekly pass found (SPEC-knowledge-07 FR-6):
 * one row per journey with its eval score, change and trend, and the latest digest as tiles that open their lists.
 */

export function KnowledgeHealth() {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      <JourneysPanel />
      <ThisWeekPanel />
    </div>
  );
}

const humanize = (value: string) => { const text = value.replace(/[-_]+/g, " ").trim(); return text ? text.charAt(0).toUpperCase() + text.slice(1) : value; };
/** Score tone: 80 and up is healthy, 60 to 79 is at risk, under 60 fails. */
const scoreTone = (score: number) => (score >= 80 ? "emerald" : score >= 60 ? "amber" : "rose");
const RING: Record<string, string> = { emerald: "stroke-emerald-500", amber: "stroke-amber-500", rose: "stroke-rose-500" };
const FIGURE: Record<string, string> = { emerald: "text-emerald-700", amber: "text-amber-700", rose: "text-rose-700" };
const TREND: Record<string, string> = { emerald: "rgb(5 150 105)", amber: "rgb(245 158 11)", rose: "rgb(225 29 72)" };

/** The latest score as a ring that fills once, the figure counting up inside it. */
export function ScoreRing({ score, size = 44 }: { score: number | null; size?: number }) {
  const tone = score === null ? null : scoreTone(score);
  const r = 15.5;
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 36 36" width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={18} cy={18} r={r} fill="none" className="stroke-ink-1/[0.07]" strokeWidth={3} />
        {score !== null && tone ? <circle cx={18} cy={18} r={r} fill="none" pathLength={100} strokeDasharray={`${score} 100`} strokeLinecap="round" strokeWidth={3} className={cn("score-ring", RING[tone])} /> : null}
      </svg>
      <span className={cn("absolute text-[13px] font-semibold tabular-nums", tone ? FIGURE[tone] : "text-ink-5")}>{score === null ? "–" : <AnimatedNumber value={score} />}</span>
    </span>
  );
}

function Delta({ now, before }: { now: number; before: number | null }) {
  if (before === null) return <span className="text-[12px] text-ink-5">First run</span>;
  const change = now - before;
  if (!change) return <span className="text-[12px] tabular-nums text-ink-4">No change</span>;
  const up = change > 0;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[12px] font-semibold tabular-nums", up ? "text-emerald-700" : "text-rose-700")} aria-label={`${up ? "Up" : "Down"} ${Math.abs(change)} since the last run`}>
      {up ? <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" /> : <ArrowDownRight className="h-3.5 w-3.5" aria-hidden="true" />}{up ? "+" : "−"}{Math.abs(change)}
    </span>
  );
}

function PanelSkeleton({ rows = 3 }: { rows?: number }) {
  return <div className="space-y-3" aria-hidden="true">{Array.from({ length: rows }, (_, index) => <Skeleton key={index} className="h-12 w-full rounded-lg" />)}</div>;
}
const errorText = (error: unknown) => (error instanceof Error ? error.message : "Could not load.");

function JourneysPanel() {
  const query = useQuery({ queryKey: knowledgeKeys.journeys, queryFn: ({ signal }) => knowledgeApi.journeys(signal) });
  const [open, setOpen] = useState<string | null>(null);
  const journeys = query.data?.journeys ?? [];
  const cases = journeys.reduce((sum, item) => sum + item.cases, 0);
  return (
    <SurfaceCard label="Journeys" note={journeys.length ? `${journeys.length} ${journeys.length === 1 ? "journey" : "journeys"} · ${cases} eval ${cases === 1 ? "case" : "cases"} · weakest first` : undefined} className="shadow-card" bodyClassName="px-2 pb-2 pt-1">
      {query.isPending ? <div className="px-2 py-2"><PanelSkeleton /></div>
        : query.error ? <p role="alert" className="px-2 py-3 text-[13px] text-rose-700">{errorText(query.error)}</p>
        : !journeys.length ? <p className="px-2 py-6 text-center text-[13.5px] text-ink-4">No eval cases yet</p>
        : (
          <ul className="stagger-children divide-y divide-line">
            {journeys.map((journey) => <JourneyRow key={journey.journey} journey={journey} open={open === journey.journey} onToggle={() => setOpen(open === journey.journey ? null : journey.journey)} />)}
          </ul>
        )}
    </SurfaceCard>
  );
}

function JourneyRow({ journey, open, onToggle }: { journey: Journey; open: boolean; onToggle: () => void }) {
  const latest = journey.latest;
  const tone = latest ? scoreTone(latest.score) : null;
  const panelId = `journey-${journey.journey}`;
  return (
    <li data-testid={`journey-${journey.journey}`}>
      <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={panelId} disabled={!latest || (!journey.failing.length && !latest.taskId)}
        className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-ink-1/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/25 disabled:cursor-default disabled:hover:bg-transparent">
        <ScoreRing score={latest ? latest.score : null} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold text-ink-1">{humanize(journey.journey)}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[12px] text-ink-4">
            <span className="tabular-nums">{journey.cases} {journey.cases === 1 ? "case" : "cases"}</span>
            {latest ? <><span aria-hidden="true">·</span><span className="tabular-nums">{latest.passed} passed{latest.partial ? `, ${latest.partial} partial` : ""}{latest.failed ? `, ${latest.failed} failed` : ""}</span><span aria-hidden="true">·</span><span>{formatRelativeTime(latest.at)}</span></> : <><span aria-hidden="true">·</span><span>Not run yet</span></>}
          </span>
        </span>
        {latest ? <Delta now={latest.score} before={journey.previous} /> : null}
        {journey.trend.length > 1 && tone ? <Sparkline values={journey.trend} color={TREND[tone]} width={72} height={24} ariaLabel={`${humanize(journey.journey)} scores: ${journey.trend.join(", ")}`} /> : <span className="w-[72px]" aria-hidden="true" />}
        <ChevronRight className={cn("h-4 w-4 shrink-0 text-ink-5 transition-transform duration-200", open && "rotate-90", !latest && "invisible")} aria-hidden="true" />
      </button>
      {open && latest ? (
        <div id={panelId} className="animate-fade-in px-2 pb-3 pl-[64px]">
          {journey.failing.length ? (
            <ul className="space-y-2">
              {journey.failing.map((item) => (
                <li key={item.path} className="text-[13px]">
                  <span className="flex flex-wrap items-baseline gap-1.5">
                    <span className={cn("rounded-full px-1.5 py-px text-[11px] font-semibold ring-1", item.result === "fail" ? "bg-rose-50 text-rose-700 ring-rose-200" : "bg-amber-50 text-amber-800 ring-amber-200")}>{item.result === "fail" ? "Failed" : "Partial"}</span>
                    <Link to={`/knowledge?path=${encodeURIComponent(item.path)}`} className="font-medium text-ink-1 hover:text-brand">{knowledgePlace(item.path.replace(/^[^/]+\/evals\//, ""))}</Link>
                  </span>
                  {item.note ? <span className="mt-0.5 block leading-5 text-ink-3">{item.note}</span> : null}
                  {item.missing?.length ? <span className="mt-0.5 block text-[12.5px] text-ink-4">Would have helped: {item.missing.map((page, index) => <span key={page}>{index ? "; " : ""}<MissingPage value={page} /></span>)}</span> : null}
                </li>
              ))}
            </ul>
          ) : <p className="text-[13px] text-ink-4">Every case passed</p>}
          {latest.taskId ? <Link to={`/tasks/${encodeURIComponent(latest.taskId)}`} className="mt-2 inline-block text-[12.5px] font-medium text-brand hover:text-brand-hover">Open the run</Link> : null}
        </div>
      ) : null}
    </li>
  );
}

/**
 * A page the answer should have used. Sonic names a page by its path, sometimes with a note after it, or describes a page
 * that does not exist yet; only a path becomes a link.
 */
function MissingPage({ value }: { value: string }) {
  const match = /^([\w.-]+(?:\/[\w.-]+)+?(?:\.md)?)(?=$|[\s(:,;])(.*)$/.exec(value.trim());
  if (!match) return <span className="text-ink-3">{value}</span>;
  const [, path, rest] = match;
  return <><Link to={`/knowledge?path=${encodeURIComponent(path)}`} className="font-medium text-brand hover:text-brand-hover">{knowledgePlace(path)}</Link>{rest.trim() ? <span className="text-ink-3"> {rest.trim()}</span> : null}</>;
}

const WEEKDAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
type DigestKey = "drafts" | "stale" | "drift" | "gaps";

function ThisWeekPanel() {
  const canDecide = useCan("knowledge.review");
  const query = useQuery({ queryKey: knowledgeKeys.pass, queryFn: ({ signal }) => knowledgeApi.pass(signal) });
  const toggle = useAction({
    mutationFn: (enabled: boolean) => knowledgeApi.setPass({ enabled }),
    invalidate: [knowledgeKeys.pass],
    success: (result) => (result.enabled ? ["Weekly pass on", `${WEEKDAYS[result.weekday]} at ${result.time}. ${AGENT_NAME} drafts what it finds; you keep what is right.`] : "Weekly pass paused"),
    error: "Weekly pass not changed",
  });
  const pass = query.data;
  const schedule = pass ? `${WEEKDAYS[pass.weekday] || "Weekly"} at ${pass.time}` : null;
  const control = pass ? (canDecide
    ? <span className="flex items-center gap-2 text-[12.5px] font-medium text-ink-2"><span aria-hidden="true">Weekly pass</span><Switch checked={pass.enabled} disabled={toggle.isPending} onCheckedChange={(value) => toggle.mutate(value)} aria-label="Weekly knowledge pass" /></span>
    : <span className="text-[12.5px] font-medium text-ink-3">Weekly pass {pass.enabled ? "on" : "off"}</span>) : null;
  return (
    <SurfaceCard label="This week" note={pass?.enabled && pass.routine?.nextRunAt ? `${schedule} · next ${formatRelativeTime(pass.routine.nextRunAt)}` : pass?.enabled ? schedule : undefined} actions={control} className="shadow-card">
      {query.isPending ? <PanelSkeleton rows={2} />
        : query.error ? <p role="alert" className="py-2 text-[13px] text-rose-700">{errorText(query.error)}</p>
        : pass?.digest ? <Digest digest={pass.digest} pass={pass} />
        : <p className="py-6 text-center text-[13.5px] text-ink-4">No pass yet</p>}
    </SurfaceCard>
  );
}

function Digest({ digest, pass }: { digest: KnowledgeDigest; pass: KnowledgePass }) {
  const [params] = useSearchParams();
  const { pathname } = useLocation();
  const list = params.get("digest") as DigestKey | null;
  // Each tile opens its list in the URL (`?digest=stale`); the open tile closes it again.
  const href = (key: DigestKey) => { const next = new URLSearchParams(params); if (list === key) next.delete("digest"); else next.set("digest", key); const text = next.toString(); return `${pathname}${text ? `?${text}` : ""}`; };
  const tiles: Array<{ key: DigestKey; label: string; value: number; tone: "violet" | "amber" | "rose" | "blue"; note?: string }> = [
    { key: "drafts", label: "Drafts waiting", value: digest.drafts.waiting, tone: "violet", note: digest.drafts.fromCorrections ? `${digest.drafts.fromCorrections} from corrections` : undefined },
    { key: "stale", label: "Past review date", value: digest.stale.length, tone: "amber" },
    { key: "drift", label: "Differs from live", value: digest.drift.length, tone: "rose" },
    { key: "gaps", label: "Gaps", value: digest.gaps.length, tone: "blue" },
  ];
  return (
    <div className="space-y-3">
      <div className="stagger-children grid grid-cols-2 gap-3">
        {tiles.map((tile) => <StatCell key={tile.key} label={tile.label} value={tile.value} tone={tile.tone} note={tile.note} to={href(tile.key)} active={list === tile.key} className="px-4 pb-3.5 pt-3" />)}
      </div>
      {list ? <DigestItems digest={digest} list={list} /> : null}
      {digest.evals.length ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Eval scores this week">
          {digest.evals.map((item) => (
            <li key={item.journey} className="inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-[12.5px]">
              <span className="font-medium text-ink-2">{humanize(item.journey)}</span>
              {item.previous !== undefined ? <span className="tabular-nums text-ink-5">{item.previous} →</span> : null}
              <span className={cn("font-semibold tabular-nums", FIGURE[scoreTone(item.score)])}>{item.score}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-[13px] leading-5 text-ink-2">{digest.summary}</p>
      <p className="flex flex-wrap items-center gap-x-1.5 text-[12.5px] text-ink-4">
        {digest.weakest ? <><span>Weakest: <span className="font-medium text-ink-2">{humanize(digest.weakest)}</span></span><span aria-hidden="true">·</span></> : null}
        <span>{formatRelativeTime(digest.at)}</span>
        {digest.taskId ? <><span aria-hidden="true">·</span><Link to={`/tasks/${encodeURIComponent(digest.taskId)}`} className="font-medium text-brand hover:text-brand-hover">Open the pass</Link></> : null}
        {pass.routine ? <><span aria-hidden="true">·</span><Link to={`/routines/${encodeURIComponent(pass.routine.name)}`} className="font-medium text-brand hover:text-brand-hover">Routine</Link></> : null}
      </p>
    </div>
  );
}

function DigestItems({ digest, list }: { digest: KnowledgeDigest; list: DigestKey }) {
  const page = (path: string) => <Link to={`/knowledge?path=${encodeURIComponent(path)}`} className="font-medium text-ink-1 hover:text-brand">{knowledgePlace(path)}</Link>;
  const rows = list === "drafts"
    ? [<li key="d" className="text-ink-3"><span className="tabular-nums">{digest.drafts.fromCorrections}</span> from corrections, <span className="tabular-nums">{digest.drafts.fromLessons}</span> from lessons{digest.drafts.merged ? <>, <span className="tabular-nums">{digest.drafts.merged}</span> duplicates merged</> : null}. Review them in each base.</li>]
    : list === "stale" ? digest.stale.map((item) => <li key={item.path}>{page(item.path)}{item.staleAfter ? <span className="text-ink-4"> · review by {item.staleAfter}</span> : null}</li>)
    : list === "drift" ? digest.drift.map((item) => <li key={`${item.path}-${item.field}`}>{page(item.path)} <span className="text-ink-4">· {item.field}: page says</span> <span className="font-mono text-[12px] text-ink-2">{item.page}</span><span className="text-ink-4">, live is</span> <span className="font-mono text-[12px] text-rose-700">{item.live}</span></li>)
    : digest.gaps.map((item, index) => <li key={index}><span className="text-ink-2">{item.text}</span>{item.journey ? <span className="text-ink-4"> · {humanize(item.journey)}</span> : null}{item.tasks.length ? <span className="text-ink-4"> · {item.tasks.slice(0, 3).map((id, at) => <span key={id}>{at ? ", " : ""}<Link to={`/tasks/${encodeURIComponent(id)}`} className="font-medium text-brand hover:text-brand-hover">{id}</Link></span>)}</span> : null}</li>);
  return (
    <ul className="animate-fade-in space-y-1.5 rounded-lg bg-surface-subtle px-3 py-2.5 text-[13px] leading-5" aria-label="Digest list">
      {rows.length ? rows : <li className="text-ink-4">Nothing this week</li>}
    </ul>
  );
}

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, ListChecks } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { OverviewAttentionItem, Ticket } from "@/api/types";
import { fetchOverviewGroup, type TicketOverview, type PipelineOverview, type DqOverview } from "@/api/overview";
import { RefreshRegion, RefreshTimestamp } from "@/components/ops/RefreshRegion";
import { useMe } from "@/auth/rbac";
import { useProject } from "@/lib/projectContext";
import { AgentMark } from "@/components/ops/AgentMark";
import { ChartLegend, ColumnChart, type ChartSeries } from "@/components/ops/charts/ColumnChart";
import { CompositionBar } from "@/components/ops/charts/CompositionBar";
import { OpsBody, OpsHead, OpsRow, OpsTable, OpsTableEmpty, OpsTd, OpsTh, TitleCell } from "@/components/ops/OpsTable";
import { ListToolbar } from "@/components/ops/ListToolbar";
import { OpsPage } from "@/components/ops/OpsPage";
import { Pager } from "@/components/ops/Pager";
import { PriorityBadge } from "@/components/ops/PriorityBadge";
import { RefreshButton } from "@/components/ops/RefreshButton";
import { ViewAllLink } from "@/components/ops/SectionHeader";
import { StatCell, StatStrip } from "@/components/ops/StatStrip";
import { HEALTH_HINT } from "@/features/monitor/pipelineWords";
import { useAssignToMe } from "@/features/tickets/useAssignToMe";
import { DisconnectedRow } from "@/components/ops/DisconnectedRow";
import { TimeRangePicker } from "@/components/ops/TimeRangePicker";
import { Button, Card, Skeleton, Tooltip, TooltipContent, TooltipTrigger, formatRelativeTime } from "@/components/ui";
import { cn, capitalise } from "@/lib/utils";
import { makeBuckets } from "@/lib/timeBuckets";
import { rangeBounds, encodeRange } from "@/lib/timeRange";
import { useTimeRange } from "@/lib/useTimeRange";
import { usePager } from "@/lib/usePager";
import { type AgentLine, type AgentToday } from "./agentLines";
import { plainConnectionReason, workReason } from "./overviewSeries";
import { AGENT_NAME, useAgentScreen, useAskSonic, useCanChat } from "@/components/ops/agentPanelContext";
import { AskSonicButton, PickedPoint } from "@/components/ops/AskSonic";
import { chartPoint, pointLabel, type WidgetPoint } from "@/features/boards/boardSelection";
import { AnimatedNumber } from "@/components/ops/AnimatedNumber";
import { queryKeys } from "@/api/queryKeys";

/**
 * The landing page. Three sections, one per domain, each with four flat tiles
 * and one honest chart built from timestamps we already have. Then the work
 * that needs this person, as a paged table. Every number links to the
 * filtered view behind it.
 *
 * The four tiles of a panel count one thing (pipelines, tickets, checks) and,
 * where they say "of N", add up to N. The agent's credit, tickets it fixed, is a
 * different thing, so it sits in the agent line under the panel and in the chart,
 * never as a fifth number that looks like part of the total.
 */

/**
 * Chart palette. Brand, ink and line come from the theme tokens in index.css; the three status
 * colours are the Tailwind steps the status pills use (rose-600, emerald-600, amber-500), which have
 * no CSS token yet. Change them here and in the pills together.
 */
const COLOR = {
  /** Neutral counts: tickets raised. */
  neutral: "var(--ops-ink-5)",
  /** Quieter neutral: runs that succeeded, checks not run. */
  quiet: "var(--ops-line-strong)",
  /** Good outcome: resolved, passed. emerald-600. */
  good: "#059669",
  /** Bad outcome: failed. rose-600. */
  bad: "#E11D48",
  /** Warning. amber-500. */
  warning: "#F59E0B",
  /** Work the agent did. */
  agent: "var(--ops-brand)",
};

/** The one phrase for the agent's credit, on every tile, legend and chart label. */
const FIXED_WITH_AGENT = `Fixed with ${AGENT_NAME}`;

/** Closed tickets the agent fixed in the window, optionally one kind (pipeline, data_quality). Tickets reads `resolved` and `kind`. */
const fixedWithAgentLink = (param: string, kind?: Ticket["kind"]) => `/tickets?scope=closed&resolved=sonic${kind ? `&kind=${kind}` : ""}&${param}`;

/** One sentence per tile on what its number counts. Business words, no system states. */
const HINT = {
  openTickets: "Tickets that are not resolved or closed yet, from every connected source.",
  highPriority: "Open tickets at priority 1 or 2.",
  waitingOnYou: `Approvals and questions from ${AGENT_NAME} that need a person's answer.`,
  resolved: `Tickets resolved or closed in this period, by people or with ${AGENT_NAME}.`,
  checksPassed: "Check results in this period whose status is passed.",
  checksWarning: "Check results in this period with a warning: outside the expected range, but not a failure.",
  checksFailed: "Check results in this period whose status is failed.",
  dqTickets: "Open tickets about data quality checks.",
  fixedWithAgent: `Tickets closed after ${AGENT_NAME} made at least one change while working on them.`,
} as const;

/** SPEC-platform-manual-refresh FR-2/3/4: independent manual snapshots. */
export function OverviewPage() {
  const { range, setRange, label, param } = useTimeRange();
  const { visitor } = useProject();
  const [refreshAt, setRefreshAt] = useState(Date.now);
  const selection = encodeRange(range);
  const bounds = useMemo(() => rangeBounds(range, refreshAt), [selection, refreshAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const buckets = useMemo(() => makeBuckets(bounds, refreshAt), [bounds, refreshAt]);
  const request = useRef({ bounds, buckets });
  request.current = { bounds, buckets };
  const tickets = useQuery({ queryKey: queryKeys.overview.group("tickets", selection), queryFn: ({ signal }) => fetchOverviewGroup("tickets", request.current.bounds, request.current.buckets, signal) });
  const pipelines = useQuery({ queryKey: queryKeys.overview.group("pipelines", selection), queryFn: ({ signal }) => fetchOverviewGroup("pipelines", request.current.bounds, request.current.buckets, signal) });
  const dq = useQuery({ queryKey: queryKeys.overview.group("data-quality", selection), queryFn: ({ signal }) => fetchOverviewGroup("data-quality", request.current.bounds, request.current.buckets, signal) });
  const agent = useQuery({ queryKey: queryKeys.overview.group("agent", selection), queryFn: ({ signal }) => fetchOverviewGroup("agent", request.current.bounds, request.current.buckets, signal), enabled: !visitor });
  const work = useQuery({ queryKey: queryKeys.overview.work, queryFn: ({ signal }) => fetchOverviewGroup("work", request.current.bounds, request.current.buckets, signal) });
  const queries = [tickets, pipelines, dq, work, ...(!visitor ? [agent] : [])];
  const busy = queries.some(q => q.isFetching);
  const refresh = () => {
    if (busy) return;
    const at = Date.now();
    const next = rangeBounds(range, at);
    request.current = { bounds: next, buckets: makeBuckets(next, at) };
    setRefreshAt(at);
    void Promise.allSettled(queries.map(q => q.refetch({ cancelRefetch: false })));
  };
  useAgentScreen(tickets.data ? { summary: `${tickets.data.ticketSummary.open} open tickets; Overview shows snapshots from its latest refresh.` } : null);
  return <OpsPage title="Overview" actions={<RefreshButton autoRefresh onClick={refresh} busy={busy} />}>
    <ListToolbar className="mb-4 gap-3">
      <TimeRangePicker value={range} onChange={next => { setRefreshAt(Date.now()); setRange(next); }} />
      <div aria-label="Section update times" className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-[12px] text-ink-4">
        {!visitor ? <RefreshTimestamp label="Sonic activity" value={agent.data?.generatedAt} /> : null}
        <RefreshTimestamp label="Tickets" value={tickets.data?.generatedAt} />
        <RefreshTimestamp label="Pipelines" value={pipelines.data?.generatedAt} />
        <RefreshTimestamp label="Data quality" value={dq.data?.generatedAt} />
        <RefreshTimestamp label="Your work" value={work.data?.generatedAt} />
      </div>
    </ListToolbar>
    <div className="space-y-10">
      {!visitor ? <RefreshRegion label="Sonic activity" query={agent} showTimestamp={false}>{agent.data ? <AgentTodayStrip today={agent.data.today} needsYou={agent.data.waiting} loading={false} /> : null}</RefreshRegion> : null}
      <RefreshRegion label="Tickets" query={tickets} showTimestamp={false}>{tickets.data ? <TicketsPanel data={tickets.data} waiting={agent.data?.waiting} buckets={tickets.data.buckets} label={label} param={param} loading={false} agent={agent.data?.lines.tickets} /> : null}</RefreshRegion>
      <RefreshRegion label="Pipelines" query={pipelines} showTimestamp={false}>{pipelines.data ? <PipelinesPanel data={pipelines.data} resolved={tickets.data?.agentResolved.pipelines} buckets={pipelines.data.buckets} param={param} label={label} loading={false} agent={agent.data?.lines.pipelines} /> : null}</RefreshRegion>
      <RefreshRegion label="Data quality" query={dq} showTimestamp={false}>{dq.data ? <DataQualityPanel data={dq.data} tickets={tickets.data} buckets={tickets.data?.buckets ?? buckets} param={param} label={label} loading={false} agent={agent.data?.lines.dataQuality} /> : null}</RefreshRegion>
      <RefreshRegion label="Your work" query={work} showTimestamp={false}>{work.data ? <YourWork items={work.data.items} scope={work.data.scope} /> : null}</RefreshRegion>
    </div>
  </OpsPage>;
}

/* ------------------------------------------------------------ agent strip */

/**
 * One row about the agent for the reporting window: finished, working now, needs you, and the most
 * recent task. Numbers are coloured only when they are not zero; the rest is data, not narrative.
 */
function AgentTodayStrip({ today, needsYou, loading }: { today: AgentToday; needsYou: number; loading: boolean }) {
  const last = today.last;
  return (
    <Card className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3" data-testid="agent-today">
      <span className="flex items-center gap-2 text-[13.5px] font-medium text-ink-2"><AgentMark size={22} state={today.working ? "thinking" : "idle"} />{AGENT_NAME}</span>
      <dl className="flex flex-wrap items-center gap-x-5 gap-y-1">
        <Figure label="finished" value={today.finished} to="/tasks?status=done" />
        <Figure label="working now" value={today.working} to="/tasks?status=running" />
        <Figure label="waiting on you" value={needsYou} to="/inbox" tone="amber" />
      </dl>
      <p className="min-w-0 flex-1 truncate text-[13px] text-ink-4 sm:text-right">
        {loading ? null : last ? (
          <>Last: <Link to={`/tasks/${encodeURIComponent(last.id)}`} className="font-medium text-ink-2 hover:text-ink-1" title={last.title}>{last.title}</Link> · <time dateTime={last.updatedAt || last.createdAt}>{formatRelativeTime(last.updatedAt || last.createdAt)}</time></>
        ) : "No tasks in this period"}
      </p>
    </Card>
  );
}

function Figure({ label, value, to, tone }: { label: string; value: number; to: string; tone?: "amber" }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="sr-only">{label}</dt>
      <dd className="m-0">
        <Link to={to} aria-label={`${label}: ${value}`} className="group inline-flex items-baseline gap-1.5 text-[13.5px] text-ink-4 hover:text-ink-2">
          <span className={cnFigure(value, tone)}><AnimatedNumber value={value} /></span>
          <span>{label}</span>
        </Link>
      </dd>
    </div>
  );
}

/** Zero stays quiet; a count takes ink; "needs you" takes amber when there is something to do. */
function cnFigure(value: number, tone?: "amber"): string {
  const base = "font-display text-[16px] font-semibold tabular-nums leading-none";
  if (!value) return `${base} text-ink-4`;
  return tone === "amber" ? `${base} text-amber-600` : `${base} text-ink-1`;
}

/* ---------------------------------------------------------------- panels */

/** The agent's credit for a panel: how many tickets it fixed in the window and where that list is. */
interface FixedWithAgent { count: number; to: string; /** "of 7 resolved" or the period label. */ suffix: string; /** What the count is a share of, for the chip's meter. */ total?: number }

/**
 * "Ask Sonic about this" on an Overview panel (SPEC-tasks-12 FR-4): the panel and the period on screen, plus a
 * picked chart column. Sonic reads the same figures back with app_overview. Off for viewers and visitors.
 */
function useAskAboutPanel(panel: "tickets" | "pipelines" | "data_quality", title: string, range: { label: string; param: string }) {
  const askSonic = useAskSonic();
  const canChat = useCanChat();
  if (!canChat) return undefined;
  return (point: WidgetPoint | null) => askSonic(
    { kind: "overview_panel", id: panel, title: point ? `${title} · ${pointLabel(point)}` : `${title} · ${range.label}`, detail: { panel, range: range.label, rangeQuery: range.param, ...(point ? { point } : {}) } },
    point ? `Explain ${pointLabel(point)} in the ${title} panel and check whether it is right.` : `Explain what the ${title} panel shows ${range.label} and check whether it is right.`,
  );
}

function Panel({ title, meta, to, toLabel, index, agent, fixed, onAsk, children }: { title: string; meta?: ReactNode; to: string; toLabel: string; index: number; agent?: AgentLine; fixed?: FixedWithAgent; onAsk?: () => void; children: ReactNode }) {
  return (
    <section className="stagger-in space-y-4" style={{ animationDelay: `${index * 40}ms` }}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-0.5">
        <h2 className="font-display text-[18px] font-semibold tracking-[-0.01em] text-ink-1">{title}</h2>
        {meta ? <p className="min-w-0 truncate text-[13px] text-ink-4">{meta}</p> : null}
        <div className="ml-auto flex items-center gap-2">{onAsk ? <AskSonicButton about={title} onClick={onAsk} /> : null}<ViewAllLink to={to}>{toLabel}</ViewAllLink></div>
      </div>
      {children}
      {agent ? <AgentFooter line={agent} fixed={fixed} /> : null}
    </section>
  );
}

/**
 * What the agent did in this domain during the window, and its credit: the tickets it fixed, as a
 * link to that list. Live work pulses; the Tasks link lands on the filtered task list.
 */
function AgentFooter({ line, fixed: given }: { line: AgentLine; fixed?: FixedWithAgent }) {
  // "0 of 0 resolved" says nothing; the chip shows once there is something to be credited against.
  const fixed = given && given.total !== 0 ? given : undefined;
  return (
    <p className="flex items-center gap-2 rounded-xl border border-line bg-raised px-3 py-2 text-[13px] text-ink-4" data-testid="agent-line">
      {line.live ? <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-brand" role="img" aria-label="In progress" /> : <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ink-5/60" aria-hidden="true" />}
      <span className="min-w-0 truncate"><span className="font-medium text-ink-3">{AGENT_NAME}</span> · {line.text}</span>
      {fixed ? <FixedWithAgentChip fixed={fixed} /> : null}
      <Link to={line.to} className={cn("group inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 font-medium text-brand transition-colors hover:bg-brand/10 hover:text-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40", !fixed && "ml-auto")}>
        <ListChecks className="h-3.5 w-3.5" aria-hidden="true" />Tasks
      </Link>
    </p>
  );
}

/**
 * The agent's credit as a pill: Sonic's mark, the count on its own badge, a small meter for the share of
 * resolved tickets when there is a total, and an arrow that nudges on hover. Emerald only when Sonic fixed
 * something; a zero stays neutral so the chip never claims credit it has not earned.
 */
function FixedWithAgentChip({ fixed }: { fixed: FixedWithAgent }) {
  const earned = fixed.count > 0;
  const share = fixed.total ? Math.min(100, Math.round((fixed.count / fixed.total) * 100)) : null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          to={fixed.to}
          aria-label={`${FIXED_WITH_AGENT}: ${fixed.count} ${fixed.suffix}`}
          className={cn(
            "group ml-auto inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border py-1 pl-1 pr-2.5 text-[12.5px] shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition-all duration-150 hover:-translate-y-px hover:shadow-[0_4px_12px_-4px_rgba(15,23,42,0.18)] focus-visible:outline-none focus-visible:ring-2",
            earned
              ? "border-emerald-200 bg-gradient-to-r from-emerald-50 via-raised to-raised text-emerald-900 hover:border-emerald-300 focus-visible:ring-emerald-400/50"
              : "border-line bg-gradient-to-r from-surface-subtle to-raised text-ink-3 hover:border-line-strong focus-visible:ring-brand/40",
          )}
        >
          <span className="relative inline-flex">
            <AgentMark size={20} state={earned ? "done" : "idle"} className={earned ? "border-emerald-200" : undefined} />
            {earned ? (
              <span className="absolute -bottom-0.5 -right-0.5 inline-flex h-2.5 w-2.5 items-center justify-center rounded-full bg-emerald-500 ring-2 ring-raised" aria-hidden="true">
                <Check className="h-1.5 w-1.5 text-white" strokeWidth={4} />
              </span>
            ) : null}
          </span>
          <span className={cn("font-medium", earned ? "text-emerald-900" : "text-ink-3")}>{FIXED_WITH_AGENT}</span>
          <span className={cn("inline-flex min-w-[22px] items-center justify-center rounded-full px-1.5 py-px font-display text-[12.5px] font-semibold tabular-nums leading-4", earned ? "bg-emerald-600 text-white" : "bg-ink-5/15 text-ink-3")}>{fixed.count}</span>
          <span className="text-ink-4">{fixed.suffix}</span>
          {share !== null ? (
            <span className="hidden h-1.5 w-12 overflow-hidden rounded-full bg-ink-5/15 sm:inline-block" aria-hidden="true">
              <span className="block h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-[width] duration-500" style={{ width: `${share}%` }} />
            </span>
          ) : null}
          <ArrowRight className={cn("h-3.5 w-3.5 transition-transform duration-150 group-hover:translate-x-0.5", earned ? "text-emerald-600" : "text-ink-4")} aria-hidden="true" />
        </Link>
      </TooltipTrigger>
      <TooltipContent side="top" align="end" className="max-w-[260px]">
        {HINT.fixedWithAgent}
        {share !== null ? <span className="mt-1 block font-medium">{share}% of resolved tickets</span> : null}
      </TooltipContent>
    </Tooltip>
  );
}

function ChartCard({ series, ariaLabel, labels, titles, loading, layout, onAsk }: { series: ChartSeries[]; ariaLabel: string; labels: string[]; titles: string[]; loading?: boolean; layout?: "stacked" | "grouped"; /** With it, a column can be picked and asked about (FR-4). */ onAsk?: (point: WidgetPoint) => void }) {
  const [picked, setPicked] = useState<number | null>(null);
  // New figures move the columns, so a pick made on the old ones is dropped.
  const figures = JSON.stringify([labels, series.map((item) => item.values)]);
  useEffect(() => { setPicked(null); }, [figures]);
  useEffect(() => {
    if (picked === null) return undefined;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setPicked(null); };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [picked]);
  // An empty period is one quiet line, not 140px of axes around nothing.
  const empty = !loading && series.every((item) => item.values.every((value) => !value));
  if (empty) return <Card role="img" aria-label={ariaLabel} className="flex h-12 items-center px-4 text-[13px] text-ink-5">No activity in this period</Card>;
  const point = onAsk && picked !== null && picked < labels.length ? chartPoint(titles[picked] || labels[picked], series, picked) : null;
  return (
    <Card className="px-4 pb-2 pt-3">
      <ChartLegend series={series} className="mb-1" />
      {point && onAsk ? <PickedPoint className="mb-2" label={pointLabel(point)} onAsk={() => onAsk(point)} onClear={() => setPicked(null)} /> : null}
      {loading ? <Skeleton className="h-[140px] w-full rounded-lg" /> : <ColumnChart labels={labels} titles={titles} series={series} height={140} ariaLabel={ariaLabel} layout={layout} picked={onAsk ? picked : null} onPick={onAsk ? (index) => setPicked((current) => (current === index ? null : index)) : undefined} />}
    </Card>
  );
}

function TicketsPanel({ data, waiting, buckets, label, param, loading, agent }: { data: TicketOverview; waiting?: number; buckets: ReturnType<typeof makeBuckets>; label: string; param: string; loading: boolean; agent?: AgentLine }) {
  const summary = data.ticketSummary;
  const raised = summary.raised ?? 0;
  const resolved = summary.closedInWindow ?? 0;
  const bySonic = data.agentResolved.inWindow;
  const series: ChartSeries[] = [{ key: "raised", name: "Raised", color: COLOR.neutral, values: data.chart.raised }, { key: "resolved", name: "Resolved", color: COLOR.good, values: data.chart.resolved }];
  const priorities = summary.byPriority;
  const ask = useAskAboutPanel("tickets", "Tickets", { label, param });
  return (
    <Panel onAsk={ask ? () => ask(null) : undefined} title="Tickets" meta={`${raised} raised and ${resolved} resolved ${label}`} to={`/tickets?${param}`} toLabel="All tickets" index={0} agent={agent} fixed={{ count: bySonic, to: fixedWithAgentLink(param), suffix: `of ${resolved} resolved`, total: resolved }}>
      <StatStrip columns={4}>
        <StatCell label="Open tickets" value={summary.open} hint={HINT.openTickets} to="/tickets" />
        <StatCell label="High priority open" value={priorities.p1 + priorities.p2} hint={HINT.highPriority} tone="rose" to="/tickets?priority=critical,high" />
        <StatCell label="Waiting on you" value={waiting ?? "?"} hint={HINT.waitingOnYou} tone="amber" to="/inbox" />
        <StatCell label="Resolved" value={resolved} suffix={label} hint={HINT.resolved} tone="emerald" to={`/tickets?scope=closed&${param}`} />
      </StatStrip>
      <ChartCard series={series} layout="grouped" labels={buckets.map((bucket) => bucket.label)} titles={buckets.map((bucket) => bucket.title)} ariaLabel="Tickets raised and resolved over time" loading={loading} onAsk={ask} />
    </Panel>
  );
}

function PipelinesPanel({ data, resolved, buckets, param, label, loading, agent }: { data: PipelineOverview; resolved?: number; buckets: ReturnType<typeof makeBuckets>; param: string; label: string; loading: boolean; agent?: AgentLine }) {
  const capability = data.capability;
  const counts = data.counts;
  const total = counts.total;
  const of = total ? `of ${total}` : undefined;
  const series: ChartSeries[] = [{ key: "succeeded", name: "Succeeded", color: COLOR.quiet, values: data.chart.succeeded }, { key: "failed", name: "Failed runs", color: COLOR.bad, values: data.chart.failed }];
  const platform = capitalise(data.platform);
  const ask = useAskAboutPanel("pipelines", "Pipelines", { label, param });
  return (
    <Panel onAsk={ask ? () => ask(null) : undefined} title="Pipelines" meta={capability?.available === false ? undefined : `${total} ${total === 1 ? "pipeline" : "pipelines"} on ${platform}${counts.other ? ` · ${counts.other} ${counts.other === 1 ? "has" : "have"} not run yet` : ""}`} to={`/monitor?${param}`} toLabel="All pipelines" index={1} agent={agent} fixed={resolved === undefined ? undefined : { count: resolved, to: fixedWithAgentLink(param, "pipeline"), suffix: `${resolved === 1 ? "ticket" : "tickets"} ${label}` }}>
      {capability?.available === false ? (
        <DisconnectedRow status="Not connected" text={plainConnectionReason(capability.reason, platform)} actionLabel="Fix connection" to="/connectors" />
      ) : (
        <>
          <StatStrip columns={4}>
            <StatCell label="Succeeded" value={counts.succeeded} suffix={of} hint={HEALTH_HINT.succeeded} tone="emerald" to={`/monitor?status=Succeeded&${param}`} />
            <StatCell label="Failed" value={counts.failed} suffix={of} hint={HEALTH_HINT.failed} tone="rose" to={`/monitor?status=Failed&${param}`} />
            <StatCell label="Missed" value={counts.missed} suffix={of} hint={HEALTH_HINT.missed} tone="amber" to={`/monitor?status=Missed&${param}`} />
            <StatCell label="Paused" value={counts.paused} suffix={of} hint={HEALTH_HINT.paused} to={`/monitor?status=Paused&${param}`} />
          </StatStrip>
          <ChartCard series={series} layout="grouped" labels={buckets.map((bucket) => bucket.label)} titles={buckets.map((bucket) => bucket.title)} ariaLabel="Pipeline runs succeeded and failed over time" loading={loading} onAsk={ask} />
        </>
      )}
    </Panel>
  );
}

function DataQualityPanel({ data, tickets, buckets, param, label, loading, agent }: { data: DqOverview; tickets?: TicketOverview; buckets: ReturnType<typeof makeBuckets>; param: string; label: string; loading: boolean; agent?: AgentLine }) {
  const fixedSeries: ChartSeries[] = [{ key: "sonic", name: FIXED_WITH_AGENT, color: COLOR.agent, values: tickets?.chart.dqResolved ?? [] }];
  const capability = { available: data.configured };
  const { total, failed, warning, passed } = data.summary;
  const other = Math.max(0, total - failed - warning - passed);
  const source = data.source ?? undefined;
  const of = total ? `of ${total}` : undefined;
  const ask = useAskAboutPanel("data_quality", "Data quality", { label, param });
  return (
    <Panel onAsk={ask ? () => ask(null) : undefined} title="Data quality" meta={capability.available ? source : undefined} to={`/data-quality?${param}`} toLabel="All checks" index={2} agent={agent} fixed={capability.available ? { count: tickets?.agentResolved.dataQuality ?? 0, to: fixedWithAgentLink(param, "data_quality"), suffix: `${tickets?.agentResolved.dataQuality === 1 ? "ticket" : "tickets"} ${label}` } : undefined}>
      {!capability.available ? (
        <DisconnectedRow status="Not set up" text="No result table set up" actionLabel="Set up" to="/data-quality" />
      ) : (
        <>
          <StatStrip columns={4}>
            <StatCell label="Checks passed" value={passed} suffix={of} hint={HINT.checksPassed} tone="emerald" to={`/data-quality?status=passed&${param}`} />
            <StatCell label="Warnings" value={warning} suffix={of} hint={HINT.checksWarning} tone="amber" to={`/data-quality?status=warning&${param}`} />
            <StatCell label="Checks failed" value={failed} suffix={of} hint={HINT.checksFailed} tone="rose" to={`/data-quality?status=failed&${param}`} />
            <StatCell label="Open data quality tickets" value={tickets?.dqOpen ?? "?"} hint={HINT.dqTickets} to="/tickets?category=data_quality" />
          </StatStrip>
          <Card className="px-4 pb-4 pt-3">
            {loading ? <Skeleton className="h-9 w-full rounded-lg" /> : (
              <CompositionBar
                ariaLabel={`${passed} passed, ${warning} warning, ${failed} failed`}
                segments={[
                  { key: "passed", name: "passed", value: passed, color: COLOR.good },
                  { key: "warning", name: "warning", value: warning, color: COLOR.warning },
                  { key: "failed", name: "failed", value: failed, color: COLOR.bad },
                  ...(other ? [{ key: "other", name: "not run", value: other, color: COLOR.quiet }] : []),
                ]}
              />
            )}
          </Card>
          {fixedSeries[0].values.some(Boolean) ? <ChartCard series={fixedSeries} labels={buckets.map((bucket) => bucket.label)} titles={buckets.map((bucket) => bucket.title)} ariaLabel={`Data quality checks fixed with ${AGENT_NAME} over time`} loading={loading} onAsk={ask} /> : null}
        </>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------- your work */

function YourWork({ items, scope }: { items: OverviewAttentionItem[]; scope: "mine" | "team" }) {
  const navigate = useNavigate();
  const me = useMe();
  const pager = usePager(items.length);
  const rows = pager.slice(items);
  const claim = useAssignToMe((ticketId) => `${ticketId} is now yours.`);
  return (
    <section className="stagger-in space-y-3" style={{ animationDelay: "120ms" }}>
      <div className="flex flex-wrap items-baseline gap-x-3 px-0.5">
        <h2 className="font-display text-[18px] font-semibold tracking-[-0.01em] text-ink-1">Your work</h2>
        <p className="text-[13px] text-ink-4">{scope === "mine" ? `${items.length} ${items.length === 1 ? "item" : "items"}` : items.length ? `Team · ${items.length} open` : "Nothing assigned to you"}</p>
      </div>
      <Card className="overflow-hidden">
        <OpsTable>
          <OpsHead>
            <OpsTh width="90px">Priority</OpsTh>
            <OpsTh width="124px">Ticket</OpsTh>
            <OpsTh>Title</OpsTh>
            <OpsTh width="260px">Why it is waiting on you</OpsTh>
            <OpsTh width="140px" align="right"><span className="sr-only">Action</span></OpsTh>
          </OpsHead>
          <OpsBody>
            {rows.map((item, index) => {
              const why = workReason(item, me.data?.user);
              return (
                <OpsRow key={item.id} index={index} onOpen={() => navigate(item.href)}>
                  <OpsTd><PriorityBadge priority={item.priority} /></OpsTd>
                  <OpsTd mono muted>{item.ticketId || "—"}</OpsTd>
                  <OpsTd><TitleCell title={item.title} to={item.href} /></OpsTd>
                  <OpsTd muted className="truncate">{why.reason}</OpsTd>
                  <OpsTd align="right">
                    {why.action === "Assign to me" && item.ticketId ? (
                      <Button size="xs" variant="outline" onClick={() => claim.mutate(item.ticketId as string)} disabled={claim.isPending} busy={claim.isPending}>Assign to me</Button>
                    ) : (
                      <Button asChild size="xs" variant="outline" className="border border-line"><Link to={item.href}>{why.action}</Link></Button>
                    )}
                  </OpsTd>
                </OpsRow>
              );
            })}
            {!rows.length ? <OpsTableEmpty colSpan={5}>No open work</OpsTableEmpty> : null}
          </OpsBody>
        </OpsTable>
        <Pager {...pager.pagerProps} noun="items" />
      </Card>
    </section>
  );
}


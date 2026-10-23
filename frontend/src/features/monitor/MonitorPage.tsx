import { useQuery } from "@tanstack/react-query";
import { Ticket as TicketIcon, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { apiClient } from "@/api/client";
import { queryKeys } from "@/api/queryKeys";
import type { CreateTicketInput, MonitorResponse, Pipeline, PipelineHealth, PipelineRun, PipelineRunPage, PipelineSlot, Ticket } from "@/api/types";
import { ACTION_LABEL, type AutomationAction } from "@/api/automation";
import { OperationalStatus, statusMeta, type StatusTone } from "@/components/ops/OperationalStatus";
import { AGENT_NAME, useAgentScreen } from "@/components/ops/agentPanelContext";
import { AskSonicButton as AskAgentButton } from "@/components/ops/AskAgentButton";
import { ticketsApi } from "@/api/tickets";
import { OpsBody, OpsHead, OpsRow, OpsTable, OpsTableEmpty, OpsTd, OpsTh, TitleCell } from "@/components/ops/OpsTable";
import { ListToolbar } from "@/components/ops/ListToolbar";
import { OpsPage } from "@/components/ops/OpsPage";
import { RefreshButton } from "@/components/ops/RefreshButton";
import { StatCell, StatStrip } from "@/components/ops/StatStrip";
import { EmptyState } from "@/components/ops/EmptyState";
import { ErrorNotice } from "@/components/ops/ErrorNotice";
import { CompactEmptyState, QueryState } from "@/components/ops/StatePanels";
import { Fact } from "@/components/ops/Fact";
import { DisconnectedRow } from "@/components/ops/DisconnectedRow";
import { TimeRangePicker } from "@/components/ops/TimeRangePicker";
import { Button, Card, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, RelativeTime, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, formatAbsoluteTime, formatDuration, formatRelativeTime, SearchInput, Skeleton } from "@/components/ui";
import { Pager } from "@/components/ops/Pager";
import { usePager } from "@/lib/usePager";
import { describeSchedule } from "@/lib/schedule";
import type { SortState } from "@/lib/tableSort";
import { rangeTitle } from "@/lib/timeRange";
import { useTimeRange } from "@/lib/useTimeRange";
import { cn, capitalise } from "@/lib/utils";
import { plainConnectionReason } from "@/features/overview/overviewSeries";
import { HEALTH_HINT, compactDuration, nextRunText, slowerThanUsual } from "./pipelineWords";
import { useAction } from "@/lib/useAction";
import { ALL, useUrlFilters, withCurrent } from "@/lib/useUrlFilters";
import { FilterSelect } from "@/components/ops/FilterSelect";

/**
 * Pipelines. One rule a business user can hold: every pipeline is healthy, failed, overdue
 * (a scheduled run did not happen) or paused. Missed also counts a pipeline that skipped a scheduled
 * start earlier in the detector's lookback, even when a later run succeeded (SPEC-automations-01 FR-41). Then one
 * row per pipeline: status, name, the runs in the period as a strip of marks, the last run with
 * its duration against the usual, the next scheduled run, and the ticket that tracks a failure.
 * Pipelines that never ran in the period stay out of the table until "Show idle".
 * A platform that cannot be read says so in one sentence. Every row and the detail sheet hand the
 * pipeline to Sonic with a question that fits its state.
 */

interface TicketTarget { pipeline: Pipeline; run: PipelineRun }


/** Business words for the health verdicts. "Succeeded" is the latest run; "Missed" is a scheduled run that did not start. */
const HEALTH_LABEL: Record<PipelineHealth, string> = { healthy: "Succeeded", failed: "Failed", overdue: "Missed", running: "Running", paused: "Paused", no_runs: "No runs", unknown: "Unknown" };
/** Older links and saved views used the previous words. */
const LEGACY_STATUS: Record<string, string> = { Healthy: "Succeeded", Overdue: "Missed" };
/** Problems first, quiet states last. */
const HEALTHY_STATES = new Set(["healthy", "success", "succeeded", "successful", "completed", "complete"]);
const FAILED_STATES = new Set(["failed", "failure", "error", "canceled", "cancelled", "timed out", "timeout"]);
const RUNNING_STATES = new Set(["running", "queued", "pending", "in progress"]);

const displayName = (pipeline: Pipeline) => pipeline.dagName || pipeline.name;
const latestRun = (pipeline: Pipeline) => pipeline.recentRuns?.[0];
const isPaused = (pipeline: Pipeline) => Boolean(pipeline.schedule && typeof pipeline.schedule === "object" && pipeline.schedule.pauseStatus === "PAUSED");

/** The backend's verdict when it gives one; otherwise the same rule applied to the latest run state. */
function healthOf(pipeline: Pipeline): PipelineHealth {
  if (pipeline.health && pipeline.health in HEALTH_LABEL) return pipeline.health;
  if (isPaused(pipeline)) return "paused";
  const state = String(pipeline.status || "").trim().toLowerCase().replace(/[\s_-]+/g, " ");
  if (!pipeline.recentRuns?.length || ["no runs", "not run"].includes(state)) return "no_runs";
  if (RUNNING_STATES.has(state)) return "running";
  if (FAILED_STATES.has(state)) return "failed";
  if (["overdue", "late", "delayed"].includes(state)) return "overdue";
  return HEALTHY_STATES.has(state) ? "healthy" : "unknown";
}
function scheduleText(pipeline: Pipeline): string {
  const raw = pipeline.schedule;
  const structured = raw && typeof raw === "object" ? raw : null;
  if (structured?.pauseStatus === "PAUSED") return "Paused";
  const text = structured ? describeSchedule(structured.quartzCronExpression, structured.timezoneId) : describeSchedule(typeof raw === "string" ? raw : null);
  return text === "Not scheduled" ? "On demand" : text;
}

/** The question a reader would ask about this pipeline, given its state. */
function sonicPrompt(pipeline: Pipeline): string {
  const name = displayName(pipeline);
  const health = healthOf(pipeline);
  const latest = latestRun(pipeline);
  if (health === "failed") return `Why did ${name} fail? What should I do?`;
  if (health === "overdue") return `Why did ${name} not run when it was due? What should I do?`;
  if (slowerThanUsual(latest?.durationMs, pipeline.typicalDurationMs)) return `Why did ${name} take longer than usual? What should I do?`;
  return `Summarize the recent runs of ${name}`;
}

/** Hands the pipeline to Sonic. */
function AskSonicButton({ pipeline, variant = "icon", onBeforeAsk }: { pipeline: Pipeline; variant?: "icon" | "outline"; onBeforeAsk?: () => void }) {
  const name = displayName(pipeline);
  return <AskAgentButton selection={{ kind: "pipeline", id: pipeline.pipelineId, title: name }} prompt={sonicPrompt(pipeline)} label={`Ask ${AGENT_NAME} about ${name}`} variant={variant} onBeforeAsk={onBeforeAsk} />;
}

type SortKey = "status" | "name" | "lastRun" | "nextRun";

function PipelineMonitorPage() {
  const navigate = useNavigate();
  const urlFilters = useUrlFilters();
  const searchParams = urlFilters.params;
  const [ticketTarget, setTicketTarget] = useState<TicketTarget | null>(null);
  const { range, setRange, bounds, label: periodLabel } = useTimeRange();
  const search = searchParams.get("q") ?? "";
  const rawStatus = searchParams.get("status") ?? ALL;
  const status = LEGACY_STATUS[rawStatus] ?? rawStatus;
  const platform = searchParams.get("platform") ?? ALL;
  const showIdle = searchParams.get("showIdle") === "1";
  const sizeValue = Number(searchParams.get("size"));
  const size = [10, 25, 50, 100].includes(sizeValue) ? sizeValue : 10;
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const offset = (page - 1) * size;
  const sortValue = searchParams.get("sort");
  const sortKey: SortKey = sortValue === "name" || sortValue === "lastRun" || sortValue === "nextRun" ? sortValue : "status";
  const sortDir = searchParams.get("dir") === "desc" ? "desc" : "asc";
  const sort: SortState<SortKey> = { key: sortKey, dir: sortDir };
  const monitorFilters = { limit: size, offset, runLimit: 10, from: bounds.from, to: bounds.to, status, platform, search: search.trim(), showIdle, sort: sort.key, dir: sort.dir };
  const query = useQuery({
    queryKey: queryKeys.monitor.list(monitorFilters),
    queryFn: ({ signal }) => apiClient.get<MonitorResponse>(`/api/monitor?${new URLSearchParams({ limit: String(size), offset: String(offset), runLimit: "10", sort: sort.key, dir: sort.dir, range: rangeTitle(range), ...(status !== ALL ? { status } : {}), ...(platform !== ALL ? { platform } : {}), ...(search.trim() ? { q: search.trim() } : {}), ...(showIdle ? { showIdle: "1" } : {}), ...(bounds.from ? { from: bounds.from } : {}), ...(bounds.to ? { to: bounds.to } : {}) })}`, { signal }),
    // A rejected platform is a state to show, not a blip to retry through; retrying only prolongs the skeleton.
    retry: false,
    refetchInterval: false,
    refetchIntervalInBackground: false,
  });
  const refreshNow = () => query.refetch({ cancelRefetch: false });
  const pipelines = useMemo(() => query.data?.items ?? [], [query.data?.items]);
  const runs = useMemo(() => query.data?.recentRuns ?? [], [query.data?.recentRuns]);
  const summary = query.data?.summary;
  const platforms = summary?.platforms ?? [];
  const statuses = summary?.statuses ?? [];
  const idleCount = summary?.matchingIdle ?? 0;
  const visible = pipelines;
  const resetKey = JSON.stringify({ search: search.trim(), status, platform, showIdle, range });
  const pager = usePager(query.data?.total ?? 0, { resetKey });
  const selectedRunId = searchParams.get("run");
  const requestedPipelineId = searchParams.get("pipeline");
  const requestedProvider = searchParams.get("provider");
  const selectedFromPage = pipelines.find((item) => item.pipelineId === requestedPipelineId && (!requestedProvider || item.platform === requestedProvider));
  const focusedPipelineQuery = useQuery({
    queryKey: queryKeys.monitor.list({ focusPipeline: requestedPipelineId, provider: requestedProvider, from: bounds.from, to: bounds.to }),
    enabled: Boolean(requestedPipelineId && !selectedFromPage),
    queryFn: ({ signal }) => apiClient.get<MonitorResponse>(`/api/monitor?${new URLSearchParams({ limit: "1", offset: "0", runLimit: "10", range: rangeTitle(range), showIdle: "1", pipelineId: requestedPipelineId || "", ...(requestedProvider ? { platform: requestedProvider } : {}), ...(bounds.from ? { from: bounds.from } : {}), ...(bounds.to ? { to: bounds.to } : {}) })}`, { signal }),
    retry: false,
    refetchInterval: false,
  });
  // A link to a run alone (a "run 900001222" citation from Sonic) opens the pipeline that run belongs to.
  const selectedPipeline = selectedFromPage ?? focusedPipelineQuery.data?.items.find((item) => item.pipelineId === requestedPipelineId)
    ?? (selectedRunId && !searchParams.get("pipeline") ? pipelines.find((item) => (item.recentRuns ?? []).some((run) => String(run.runId) === selectedRunId)) : undefined);

  const createTicket = useAction({
    mutationFn: async ({ target, investigate }: { target: TicketTarget; investigate: boolean }) => {
      const input: CreateTicketInput = { pipelineId: target.pipeline.pipelineId, runId: target.run.runId, platform: target.pipeline.platform || target.run.platform, priority: "medium" };
      const ticket = await apiClient.post<Ticket>("/api/tickets", input);
      const task = investigate ? (await ticketsApi.investigate(ticket.ticketId, { permission: "policy" })).task : null;
      return { ticket, task };
    },
    invalidate: [queryKeys.monitor.all, queryKeys.overview.all, queryKeys.tickets.all],
    success: ({ ticket, task }) => ["Ticket created", task ? `${ticket.ticketId} tracks this failure. ${AGENT_NAME} is looking into it.` : `${ticket.ticketId} now tracks this failed run.`],
    onSuccess: ({ task }) => { setTicketTarget(null); if (task) navigate(`/tasks/${encodeURIComponent(task.id)}`); },
    error: "Ticket not created",
  });

  const setParam = (key: string, value: string | null) => urlFilters.update((next) => { if (value === null || value === "" || value === ALL) next.delete(key); else next.set(key, value); next.delete("page"); });
  const toggleSort = (key: SortKey) => urlFilters.update((next) => {
    const current = next.get("sort") || "status"; const direction = next.get("dir") || "asc";
    next.set("sort", key); next.set("dir", current === key && direction === "asc" ? "desc" : "asc"); next.delete("page");
  });
  const openRun = (pipeline: Pipeline, run: PipelineRun) => urlFilters.update((next) => {
    next.set("pipeline", pipeline.pipelineId);
    next.set("run", run.runId);
    if (pipeline.platform) next.set("provider", pipeline.platform);
  }, false);
  const closeDetail = () => urlFilters.clear("pipeline", "run", "provider");
  const openTicketFor = (pipeline: Pipeline, run: PipelineRun) => {
    const linked = run.ticket?.ticketId || (run.runId === latestRun(pipeline)?.runId ? pipeline.ticket?.ticketId : undefined);
    if (linked) { navigate(`/tickets/${encodeURIComponent(linked)}`); return; }
    setTicketTarget({ pipeline, run });
  };

  const healthyCount = summary?.succeeded ?? 0; const failedCount = summary?.failed ?? 0; const overdueCount = summary?.missed ?? 0; const pausedCount = summary?.paused ?? 0;
  const idleTotal = summary?.idle ?? 0;
  const ofAll = query.data?.workspaceTotal ? `of ${query.data.workspaceTotal}` : undefined;
  useAgentScreen({
    visible: visible.map((pipeline) => `${displayName(pipeline)} (${pipeline.pipelineId})`),
    open: selectedPipeline ? { kind: "pipeline", id: selectedPipeline.pipelineId, title: displayName(selectedPipeline) } : null,
    summary: `${query.data?.workspaceTotal ?? 0} pipelines ${periodLabel}: ${healthyCount} succeeded, ${failedCount} failed, ${overdueCount} missed a scheduled run, ${pausedCount} paused, ${idleTotal} with no run`,
  });
  const providerErrors = (query.data?.diagnostics?.providers ?? []).filter((item) => item.error);
  const connectionError = query.error ? (query.error instanceof Error ? query.error.message : "The pipeline platform could not be reached.") : null;
  const disconnected = Boolean(connectionError) || (Boolean(query.data) && pipelines.length === 0 && (query.data?.workspaceTotal ?? 0) === 0);
  const platformName = platforms.length === 1 ? capitalise(platforms[0]) : platforms.length ? platforms.map(capitalise).join(" and ") : "Databricks";
  const activeFilters = Number(Boolean(search.trim())) + Number(status !== ALL) + Number(platform !== ALL);
  const rangeParam = searchParams.get("range");
  const withRange = (params: string) => `/monitor?${params}${rangeParam ? `&range=${encodeURIComponent(rangeParam)}` : ""}`;

  return (
    <OpsPage
      title="Pipelines"
      count={query.data && !disconnected ? `${query.data.workspaceTotal ?? 0} ${(query.data.workspaceTotal ?? 0) === 1 ? "pipeline" : "pipelines"} on ${platformName} · ${runs.length} ${runs.length === 1 ? "run" : "runs"} ${periodLabel}${query.data.diagnostics?.source === "ledger" && query.data.fetchedAt ? ` · updated ${formatRelativeTime(query.data.fetchedAt)}` : ""}` : undefined}
      actions={<RefreshButton autoRefresh onClick={() => void refreshNow()} busy={query.isFetching} updatedAt={query.data?.fetchedAt} />}
    >
      <div className="mb-4 flex items-center gap-3"><TimeRangePicker value={range} onChange={setRange} /></div>
      <QueryState query={{ isPending: query.isPending, error: null }}>
        {disconnected ? (
          <DisconnectedState reason={connectionError || providerErrors[0]?.error || null} platform={providerErrors[0]?.provider} />
        ) : (
          <div className="space-y-4">
            <StatStrip columns={4}>
              <StatCell label="Succeeded" value={healthyCount} suffix={ofAll} hint={HEALTH_HINT.succeeded} tone="emerald" to={withRange("status=Succeeded")} active={status === "Succeeded"} />
              <StatCell label="Failed" value={failedCount} suffix={ofAll} hint={HEALTH_HINT.failed} tone="rose" to={withRange("status=Failed")} active={status === "Failed"} />
              <StatCell label="Missed" value={overdueCount} suffix={ofAll} hint={HEALTH_HINT.missed} tone="amber" to={withRange("status=Missed")} active={status === "Missed"} />
              <StatCell label="Paused" value={pausedCount} suffix={ofAll} hint={HEALTH_HINT.paused} to={withRange("status=Paused")} active={status === "Paused"} />
            </StatStrip>

            {providerErrors.length ? (
              <div className="rounded-xl border border-line bg-surface-subtle px-4 py-2.5 text-[13.5px] text-ink-3">
                {providerErrors.map((item) => <p key={item.provider}><span className="font-medium text-ink-2">{capitalise(item.provider)}</span>: {plainConnectionReason(item.error, capitalise(item.provider))} <Link to="/connectors" className="font-semibold text-brand hover:text-brand-hover">Fix connection</Link></p>)}
              </div>
            ) : null}

            <Card className="overflow-clip">
              {query.data?.diagnostics?.truncated ? <div className="border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-900">Run history reached the {query.data.diagnostics.maxRuns} run limit. Narrow the period for complete results.</div> : null}
              <ListToolbar placement="card" className="border-b border-line px-4 py-3">
                <SearchInput id="pipeline-search" className="min-w-[220px] flex-1" label="Search pipelines" value={search} onValueChange={(value) => setParam("q", value)} />
                <FilterSelect label="Status" plural="statuses" value={status} onChange={(value) => setParam("status", value)} options={withCurrent(statuses, status).map((item) => ({ value: item, label: item }))} />
                {platforms.length > 1 ? (
                  <FilterSelect label="Platform" plural="platforms" value={platform} onChange={(value) => setParam("platform", value)} options={platforms.map((item) => ({ value: item, label: capitalise(item), className: "capitalize" }))} />
                ) : null}
                {idleCount || showIdle ? <Button variant="outline" size="sm" className="border border-line" aria-pressed={showIdle} onClick={() => setParam("showIdle", showIdle ? null : "1")}>{showIdle ? "Hide idle" : `Show idle (${idleCount})`}</Button> : null}
                {activeFilters ? <Button variant="ghost" size="sm" onClick={() => urlFilters.clear("q", "status", "platform")}><X className="h-3.5 w-3.5" />Clear {activeFilters}</Button> : null}
              </ListToolbar>
              {!visible.length && !activeFilters
                ? <EmptyState illustration="pipelines" title={idleCount ? `No pipeline ran ${periodLabel}` : "No pipelines"} body={idleCount ? `${idleCount} ${idleCount === 1 ? "pipeline is" : "pipelines are"} idle. Show idle to see them, or widen the period.` : `Jobs on ${platformName} that match the monitoring filter show up here.`} />
                : <><PipelineRows rows={visible} sort={sort} onSort={toggleSort} onOpenRun={openRun} onTicket={openTicketFor} emptyText="No pipelines match these filters" /><Pager {...pager.pagerProps} sizes={[10, 25, 50, 100]} noun="pipelines" /></>}
              {idleCount && !showIdle ? <p className="border-t border-line px-4 py-2 text-[12.5px] text-ink-4">{idleCount} {idleCount === 1 ? "pipeline" : "pipelines"} had no runs {periodLabel}</p> : null}
            </Card>
          </div>
        )}
      </QueryState>

      <Sheet open={Boolean(selectedPipeline)} onOpenChange={(open) => !open && closeDetail()}>
        <SheetContent side="right" className="w-full sm:max-w-3xl">
          {selectedPipeline ? <PipelineDetail pipeline={selectedPipeline} selectedRunId={selectedRunId} onTicket={(run) => openTicketFor(selectedPipeline, run)} onClose={closeDetail} /> : null}
        </SheetContent>
      </Sheet>

      <Dialog open={Boolean(ticketTarget)} onOpenChange={(open) => !open && setTicketTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a ticket for this failure</DialogTitle>
            <DialogDescription>No open ticket in ServiceNow, Jira or NerveCenter mentions this job, so nothing tracks this failure yet.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 px-5 text-[14px]">
            <p><strong>{ticketTarget?.pipeline.name}</strong></p>
            <p className="font-mono text-[12.5px] text-ink-4">{ticketTarget?.run.runId}</p>
            <p className="text-ink-3">{ticketTarget?.run.failureSummary || "The platform marked this run as failed."}</p>
            {createTicket.error ? <ErrorNotice compact what="The ticket was not created." why={createTicket.error instanceof Error ? createTicket.error.message : "Try again."} /> : null}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTicketTarget(null)}>Cancel</Button>
            <Button variant="outline" className="border border-line" onClick={() => ticketTarget && createTicket.mutate({ target: ticketTarget, investigate: false })} disabled={createTicket.isPending} busy={createTicket.isPending}><TicketIcon className="h-4 w-4" />Create ticket</Button>
            <Button variant="primary" onClick={() => ticketTarget && createTicket.mutate({ target: ticketTarget, investigate: true })} disabled={createTicket.isPending} busy={createTicket.isPending}>{createTicket.isPending ? "Creating" : `Create and ask ${AGENT_NAME}`}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </OpsPage>
  );
}

export function MonitorPage() {
  const [searchParams] = useSearchParams();
  if (["kpi", "business-checks", "data-quality"].includes(searchParams.get("view") || "")) {
    const next = new URLSearchParams(searchParams);
    next.delete("view");
    return <Navigate to={`/data-quality${next.size ? `?${next.toString()}` : ""}`} replace />;
  }
  return <PipelineMonitorPage />;
}

function DisconnectedState({ reason, platform }: { reason: string | null; platform?: string }) {
  const name = platform ? capitalise(platform) : "Databricks";
  return (
    <DisconnectedRow status="Not connected" srTitle="Pipelines are not connected" text={plainConnectionReason(reason, name)} actionLabel="Fix connection" to="/connectors" />
  );
}

/** The pipeline's one-word state as a pill. */
function HealthPill({ pipeline }: { pipeline: Pipeline }) {
  const health = healthOf(pipeline);
  return <OperationalStatus value={health === "no_runs" ? "no runs" : health} label={HEALTH_LABEL[health]} />;
}

const MARK: Record<StatusTone, string> = { success: "bg-emerald-500", bad: "bg-rose-500", warning: "bg-amber-400", review: "bg-violet-400", info: "bg-blue-400", neutral: "bg-slate-300" };

/** The period's runs, oldest to newest, one mark each. A streak of red is visible without reading. */
function RunMarks({ pipeline, onOpenRun }: { pipeline: Pipeline; onOpenRun: (pipeline: Pipeline, run: PipelineRun) => void }) {
  const ordered = [...(pipeline.recentRuns ?? [])].reverse().slice(-10);
  if (!ordered.length) return <span className="text-ink-5">—</span>;
  const tally = new Map<string, number>();
  for (const run of ordered) { const label = statusMeta(run.status).label.toLowerCase(); tally.set(label, (tally.get(label) ?? 0) + 1); }
  const summary = `${ordered.length} ${ordered.length === 1 ? "run" : "runs"}: ${[...tally].map(([label, n]) => `${n} ${label}`).join(", ")}`;
  return (
    <span role="group" aria-label={summary} title={summary} className="inline-flex items-center gap-[3px]">
      {ordered.map((run) => {
        const meta = statusMeta(run.status);
        return <button key={run.runId} type="button" aria-label={`${meta.label}, ${run.startTime ? formatAbsoluteTime(run.startTime) : "time unknown"}`} onClick={(event) => { event.stopPropagation(); onOpenRun(pipeline, run); }} className={cn("h-3.5 w-[7px] rounded-[2px] transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-1", MARK[meta.tone])} />;
      })}
    </span>
  );
}

/** "2h ago, 6m · usually 5m". The duration turns amber only when it is well over the usual. */
function LastRunCell({ pipeline }: { pipeline: Pipeline }) {
  const latest = latestRun(pipeline);
  if (!latest?.startTime) return <span className="text-ink-5">—</span>;
  const duration = typeof latest.durationMs === "number" ? latest.durationMs : null;
  const usual = pipeline.typicalDurationMs ?? null;
  const slow = slowerThanUsual(duration, usual);
  return (
    <>
      <RelativeTime value={latest.startTime} className="text-ink-3" />
      {duration !== null ? <span className={slow ? "font-medium text-amber-700" : "text-ink-5"} title={slow ? "Slower than usual" : undefined}>, {compactDuration(duration)}</span> : null}
      {usual !== null ? <span className="text-ink-5"> · usually {compactDuration(usual)}</span> : null}
    </>
  );
}

function NextRunCell({ pipeline }: { pipeline: Pipeline }) {
  const schedule = scheduleText(pipeline);
  if (isPaused(pipeline) || healthOf(pipeline) === "paused") return <span className="text-ink-5">Paused</span>;
  if (pipeline.nextRunAt) return <span title={schedule}>{nextRunText(pipeline.nextRunAt)}</span>;
  return <span title={schedule === "On demand" ? undefined : schedule} className="text-ink-5">{schedule}</span>;
}

function PipelineRows({ rows, sort, onSort, onOpenRun, onTicket, emptyText }: { rows: Pipeline[]; sort: SortState<SortKey>; onSort: (key: SortKey) => void; onOpenRun: (pipeline: Pipeline, run: PipelineRun) => void; onTicket: (pipeline: Pipeline, run: PipelineRun) => void; emptyText: string }) {
  const sorted = rows;
  return (
    <>
    <OpsTable>
      <OpsHead>
        <OpsTh sortKey="status" sort={sort} onSort={onSort} width="130px">Status</OpsTh>
        <OpsTh sortKey="name" sort={sort} onSort={onSort}>Pipeline</OpsTh>
        <OpsTh width="140px">Runs</OpsTh>
        <OpsTh sortKey="lastRun" sort={sort} onSort={onSort} width="220px">Last run</OpsTh>
        <OpsTh sortKey="nextRun" sort={sort} onSort={onSort} width="150px">Next run</OpsTh>
        <OpsTh width="200px" align="right" className="pr-6"><span className="sr-only">Actions</span></OpsTh>
      </OpsHead>
      <OpsBody>
        {sorted.map((pipeline, index) => {
          const latest = latestRun(pipeline);
          return (
            <OpsRow key={`${pipeline.platform || "unknown"}:${pipeline.pipelineId}`} index={index} onOpen={latest ? () => onOpenRun(pipeline, latest) : undefined}>
              <OpsTd><HealthPill pipeline={pipeline} /></OpsTd>
              <OpsTd><TitleCell title={displayName(pipeline)} subtitle={[pipeline.platform ? capitalise(pipeline.platform) : "", missedText(pipeline)].filter(Boolean).join(" · ") || undefined} onOpen={latest ? () => onOpenRun(pipeline, latest) : undefined} /></OpsTd>
              <OpsTd nowrap><RunMarks pipeline={pipeline} onOpenRun={onOpenRun} /></OpsTd>
              <OpsTd muted nowrap><LastRunCell pipeline={pipeline} /></OpsTd>
              <OpsTd muted nowrap><NextRunCell pipeline={pipeline} /></OpsTd>
              <OpsTd align="right" className="pr-6">
                <span className="inline-flex items-center justify-end gap-1.5">
                  {pipeline.alert?.taskId ? <TaskLink taskId={pipeline.alert.taskId} label={pipeline.alert.investigation === "finished" ? "Investigated" : "Investigating"} /> : null}
                  {pipeline.ticket && healthOf(pipeline) === "failed" ? <LinkedTicket ticket={pipeline.ticket} onClick={() => latest && onTicket(pipeline, latest)} /> : pipeline.ticketAction === "create" && latest ? <Button size="xs" variant="outline" className="border border-line" onClick={() => onTicket(pipeline, latest)}><TicketIcon className="h-3.5 w-3.5" />Create ticket</Button> : null}
                  <AskSonicButton pipeline={pipeline} />
                </span>
              </OpsTd>
            </OpsRow>
          );
        })}
        {!sorted.length ? <OpsTableEmpty colSpan={6}>{emptyText}</OpsTableEmpty> : null}
      </OpsBody>
    </OpsTable>
    </>
  );
}

/** "2 missed, 1 late in the last day" over the detector's lookback, or nothing. */
function missedText(pipeline: Pipeline): string {
  const parts = [pipeline.missedCount ? `${pipeline.missedCount} missed` : "", pipeline.lateCount ? `${pipeline.lateCount} late` : ""].filter(Boolean);
  return parts.length ? `${parts.join(", ")} in the last day` : "";
}

/** The task that looked at a run, a slot or the pipeline's open alert. */
function TaskLink({ taskId, label = "Task" }: { taskId: string; label?: string }) {
  return (
    <Button asChild size="xs" variant="outline" className="border border-line">
      <Link to={`/tasks/${encodeURIComponent(taskId)}`} onClick={(event) => event.stopPropagation()} title={`Open task ${taskId}`}>{label}</Link>
    </Button>
  );
}

/** The ticket that already tracks this pipeline's failure, by its source number. */
function LinkedTicket({ ticket, onClick }: { ticket: NonNullable<Pipeline["ticket"]>; onClick: () => void }) {
  return (
    <Button size="xs" variant="outline" className="max-w-[150px] border border-line" onClick={(event) => { event.stopPropagation(); onClick(); }} title={ticket.title}>
      <TicketIcon className="h-3.5 w-3.5 shrink-0" /><span className="truncate font-mono text-[12.5px]">{ticket.number || ticket.ticketId}</span>
    </Button>
  );
}

/** Status, start, duration, task, ticket and run ID share fixed columns so every run lines up. */
const RUN_GRID = "grid grid-cols-[104px_minmax(0,1fr)_64px] items-center gap-x-3 sm:grid-cols-[104px_minmax(0,1fr)_64px_104px_116px_112px]";
const SLOT_LABEL: Record<PipelineSlot["status"], string> = { missed: "Missed", overdue: "Not started", late: "Started late" };

function PipelineDetail({ pipeline, selectedRunId, onTicket, onClose }: { pipeline: Pipeline; selectedRunId: string | null; onTicket: (run: PipelineRun) => void; onClose: () => void }) {
  const latest = latestRun(pipeline);
  // The whole stored history, a page at a time (SPEC-pipelines-01 FR-15); the page's own recent runs show until it loads.
  const [total, setTotal] = useState(0);
  const pager = usePager(total, { prefix: "runs", resetKey: `${pipeline.platform}:${pipeline.pipelineId}` });
  const history = useQuery({
    queryKey: [...queryKeys.pipelines.runs(pipeline.pipelineId), { provider: pipeline.platform ?? null, limit: pager.size, offset: pager.offset }],
    queryFn: ({ signal }) => apiClient.get<PipelineRunPage>(`/api/pipelines/${encodeURIComponent(pipeline.pipelineId)}/runs?limit=${pager.size}&offset=${pager.offset}${pipeline.platform ? `&provider=${encodeURIComponent(pipeline.platform)}` : ""}`, { signal }),
    placeholderData: (previous) => previous,
    refetchInterval: false,
  });
  useEffect(() => { if (history.data) setTotal(history.data.total); }, [history.data]);
  const runs = history.data?.items ?? (history.isPending ? [] : pipeline.recentRuns ?? []);
  const slots = history.data?.slots ?? [];
  const usual = pipeline.typicalDurationMs ?? null;
  const duration = typeof latest?.durationMs === "number" ? compactDuration(latest.durationMs) : "—";
  return (
    <>
      <SheetHeader>
        <div className="flex flex-wrap items-center gap-2"><HealthPill pipeline={pipeline} /><span className="text-[13px] text-ink-4">{pipeline.platform ? capitalise(pipeline.platform) : "Platform"} · {scheduleText(pipeline)}</span></div>
        <div className="mt-2 flex items-start justify-between gap-3">
          <SheetTitle className="text-[18px] leading-snug">{displayName(pipeline)}</SheetTitle>
          <AskSonicButton pipeline={pipeline} variant="outline" onBeforeAsk={onClose} />
        </div>
        {pipeline.summary ? <SheetDescription>{pipeline.summary}</SheetDescription> : null}
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          <Fact label="Last run" value={latest?.startTime ? formatAbsoluteTime(latest.startTime) : "—"} />
          <Fact label="Duration" value={usual !== null ? `${duration} · usually ${compactDuration(usual)}` : duration} />
          <Fact label="Next run" value={healthOf(pipeline) === "paused" ? "Paused" : pipeline.nextRunAt ? formatAbsoluteTime(pipeline.nextRunAt) : scheduleText(pipeline)} />
          <Fact label="Owner" value={pipeline.owner || "—"} />
          <Fact label="Pipeline ID" value={pipeline.pipelineId} mono />
          {pipeline.ticket ? <Fact label="Ticket" value={pipeline.ticket.number || pipeline.ticket.ticketId} mono /> : null}
          {pipeline.automation ? <Fact label="When it fails" value={ACTION_LABEL[pipeline.automation.pipelineFailed as AutomationAction] ?? pipeline.automation.pipelineFailed} /> : null}
          {pipeline.automation ? <Fact label="When it is late" value={ACTION_LABEL[pipeline.automation.pipelineLate as AutomationAction] ?? pipeline.automation.pipelineLate} /> : null}
        </dl>
      </SheetHeader>
      {slots.length ? (
        <div className="border-b border-line px-6 py-5">
          <h3 className="text-[12px] font-medium text-ink-5">Missed and late starts</h3>
          <ol className="mt-2 divide-y divide-line">
            {slots.map((slot) => (
              <li key={slot.at} className="flex items-center justify-between gap-3 py-2.5">
                <span className="flex min-w-0 items-center gap-3">
                  <OperationalStatus value={slot.status === "late" ? "late" : "overdue"} label={SLOT_LABEL[slot.status]} />
                  <span className="truncate text-[14px] font-medium tabular-nums text-ink-1">Due {formatAbsoluteTime(slot.at)}</span>
                  {slot.startedAt ? <span className="hidden text-[13px] text-ink-4 sm:inline">started {formatAbsoluteTime(slot.startedAt)}</span> : null}
                </span>
                {slot.taskId ? <TaskLink taskId={slot.taskId} /> : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      <div className="px-6 py-5">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-[12px] font-medium text-ink-5">Runs{total ? <span className="ml-1 tabular-nums">{total}</span> : null}</h3>
          {latest && pipeline.ticketAction === "create" ? <Button size="sm" variant="primary" onClick={() => onTicket(latest)}><TicketIcon className="h-3.5 w-3.5" />Create ticket</Button> : null}
        </div>
        {history.isPending && !runs.length ? (
          <div className="mt-3 space-y-2" role="status" aria-label="Loading runs"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-5/6" /><Skeleton className="h-4 w-2/3" /></div>
        ) : runs.length ? (
          <>
            <div aria-hidden="true" className={`${RUN_GRID} mt-3 border-b border-line pb-2 text-[12px] font-medium text-ink-5`}>
              <span>Status</span><span>Started</span><span className="text-right">Duration</span><span className="hidden text-right sm:block">Task</span><span className="hidden text-right sm:block">Ticket</span><span className="hidden text-right sm:block">Run ID</span>
            </div>
            <ol className="divide-y divide-line">
              {runs.map((run) => {
                const ticket = run.ticket || (run.runId === latest?.runId ? pipeline.ticket : undefined);
                return (
                  <li key={run.runId} className={`py-2.5 ${run.runId === selectedRunId ? "-mx-3 rounded-lg bg-surface-subtle px-3" : ""}`}>
                    <div className={RUN_GRID}>
                      <span><OperationalStatus value={run.status} label={statusMeta(run.status).label === "In progress" ? "Running" : undefined} /></span>
                      <span className="truncate text-[14px] font-medium tabular-nums text-ink-1">{run.startTime ? formatAbsoluteTime(run.startTime) : "—"}</span>
                      <span className={cn("text-right text-[13px] tabular-nums", slowerThanUsual(run.durationMs, usual) ? "font-medium text-amber-700" : "text-ink-4")} title={slowerThanUsual(run.durationMs, usual) ? "Slower than usual" : undefined}>{typeof run.durationMs === "number" ? formatDuration(run.durationMs) : "—"}</span>
                      <span className="hidden justify-end sm:flex">{run.taskId ? <TaskLink taskId={run.taskId} /> : null}</span>
                      <span className="hidden justify-end sm:flex">{ticket ? <LinkedTicket ticket={ticket} onClick={() => onTicket(run)} /> : null}</span>
                      <span className="hidden truncate text-right font-mono text-[12px] text-ink-5 sm:block" title={run.runId}>{run.runId}</span>
                    </div>
                    {run.failureSummary ? <p className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-rose-50 px-3 py-2 text-[13.5px] leading-5 text-rose-800 sm:ml-[116px]">{run.failureSummary}</p> : null}
                  </li>
                );
              })}
            </ol>
            <Pager {...pager.pagerProps} noun="runs" className="-mx-6 mt-2 border-t px-6" />
          </>
        ) : <CompactEmptyState>No runs</CompactEmptyState>}
      </div>
    </>
  );
}



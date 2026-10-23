import { useQuery } from "@tanstack/react-query";
import { ListTodo, Pencil, Plus, Settings2, Ticket as TicketIcon, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { dataQualityApi } from "@/api/data-quality";
import { queryKeys } from "@/api/queryKeys";
import type { DataQualityConfiguration, DataQualityMonitorResponse, DataQualityResult } from "@/api/types";
import { AGENT_NAME, useAgentScreen } from "@/components/ops/agentPanelContext";
import { AskSonicButton as AskAgentButton } from "@/components/ops/AskAgentButton";
import { OperationalStatus } from "@/components/ops/OperationalStatus";
import { OpsBody, OpsHead, OpsRow, OpsTable, OpsTableEmpty, OpsTd, OpsTh, TitleCell } from "@/components/ops/OpsTable";
import { PriorityBadge } from "@/components/ops/PriorityBadge";
import { ListToolbar } from "@/components/ops/ListToolbar";
import { OpsPage } from "@/components/ops/OpsPage";
import { RefreshButton } from "@/components/ops/RefreshButton";
import { useResultTableEditor } from "@/components/ops/ResultTableEditor";
import { StatCell, StatStrip } from "@/components/ops/StatStrip";
import { EmptyState } from "@/components/ops/EmptyState";
import { CompactEmptyState, TableSkeleton } from "@/components/ops/StatePanels";
import { Fact } from "@/components/ops/Fact";
import { DisconnectedRow } from "@/components/ops/DisconnectedRow";
import { TimeRangePicker } from "@/components/ops/TimeRangePicker";
import { FilterSelect } from "@/components/ops/FilterSelect";
import { Button, Card, Sheet, SheetContent, SheetHeader, SheetTitle, formatAbsoluteTime, formatRelativeTime, SearchInput } from "@/components/ui";
import { plainConnectionReason } from "@/features/overview/overviewSeries";
import { byPriority, byStatus, byText, useTableSort } from "@/lib/tableSort";
import { rangeTitle } from "@/lib/timeRange";
import { useTimeRange } from "@/lib/useTimeRange";
import { ALL, useUrlFilters, withCurrent } from "@/lib/useUrlFilters";
import { resultColumns, type ResultColumns } from "./resultColumns";
import { capitalise } from "@/lib/utils";
import { Pager } from "@/components/ops/Pager";
import { usePager } from "@/lib/usePager";

/**
 * Data quality: check results read from the client's own DQ result tables (one or several).
 * Four numbers and one table. The table's optional columns (dataset, rule, failed rows) follow the
 * column mapping of the result tables set up here, so a table without a rule column shows no empty
 * Rule column. A failed check links to the ticket that tracks it;
 * investigating a failure is a Task for the agent (docs/DESIGN.md). Filters live in the URL so a
 * filtered view can be shared and Sonic sees the same filters the reader does. Once the background
 * fetch has stored results, the server filters and pages them, so every result in the period is
 * reachable (SPEC-data-quality-02, SPEC-platform-11); before that the page filters what it read.
 */

const STATUS_CHOICES = ["passed", "failed", "warning", "status_not_reported"];
const SEVERITY_CHOICES = ["critical", "high", "medium", "low", "info"];


/** One sentence per tile on what its number counts. */
const HINT = {
  run: "Check results read from the result table in this period, one per check run.",
  passed: "Results in this period whose status is passed.",
  warning: "Results in this period with a warning: outside the expected range, but not a failure.",
  failed: "Results in this period whose status is failed.",
} as const;

function resultHref(item: DataQualityResult): string | null {
  const ticketId = item.ticket?.ticketId || item.routing?.ticketId;
  return ticketId ? `/tickets/${encodeURIComponent(ticketId)}` : null;
}

const fullName = (table: Pick<DataQualityConfiguration, "catalog" | "schema" | "resultTable">) => `${table.catalog}.${table.schema}.${table.resultTable}`;
const tableLabel = (table: Pick<DataQualityConfiguration, "name" | "resultTable">) => table.name || table.resultTable;

const checkPlace = (item: DataQualityResult) => item.dataset ? `${item.dataset}${item.field ? `.${item.field}` : ""}` : item.table || "the result table";
/** "Investigate" on a failed check; a plain question for the rest. */
function sonicPrompt(item: DataQualityResult): string {
  if (item.status === "failed") return `Investigate the failing check ${item.name} on ${checkPlace(item)}: why is it failing, what is the impact, and is there an open ticket for it?`;
  return `Tell me about the check ${item.name} on ${checkPlace(item)}: what it tests, how it has been doing, and whether anything needs attention.`;
}

/** Hands the check to Sonic. */
function AskSonicButton({ item, variant = "icon", onBeforeAsk }: { item: DataQualityResult; variant?: "icon" | "investigate" | "outline"; onBeforeAsk?: () => void }) {
  return <AskAgentButton selection={{ kind: "dq_check", id: item.checkId, title: item.name }} prompt={sonicPrompt(item)} label={`Ask ${AGENT_NAME} about ${item.name}`} variant={variant === "investigate" ? "primary" : variant} onBeforeAsk={onBeforeAsk} />;
}

export function DataQualityPage() {
  const navigate = useNavigate();
  const { range, setRange, bounds, label: periodLabel } = useTimeRange();
  const urlFilters = useUrlFilters();
  const [selectedResult, setSelectedResult] = useState<DataQualityResult | null>(null);
  const resultStatus = urlFilters.get("status") ?? ALL;
  const severity = urlFilters.get("severity") ?? ALL;
  const tableFilter = urlFilters.get("table") ?? ALL;
  const resultSearch = urlFilters.get("q") ?? "";
  const tableProviders = useQuery({ queryKey: queryKeys.dataQuality.providers, queryFn: ({ signal }) => dataQualityApi.providers(signal) });
  const tableConfig = useQuery({ queryKey: queryKeys.dataQuality.config, queryFn: ({ signal }) => dataQualityApi.config(signal) });
  const tableParam = urlFilters.get("table") ?? ALL;
  const [serverTotal, setServerTotal] = useState<number | null>(null);
  const filterKey = JSON.stringify({ resultStatus, severity, tableParam, resultSearch, from: bounds.from, to: bounds.to });
  const pager = usePager(serverTotal ?? 0, { resetKey: filterKey });
  const results = useQuery({
    queryKey: [...queryKeys.dataQuality.monitor(bounds.from, bounds.to), { status: resultStatus, severity, table: tableParam, q: resultSearch.trim(), limit: pager.size, offset: pager.offset }],
    queryFn: ({ signal }) => dataQualityApi.monitor({ range: rangeTitle(range), from: bounds.from, to: bounds.to }, { status: resultStatus, severity, table: tableParam, q: resultSearch.trim(), limit: pager.size, offset: pager.offset }, signal),
    placeholderData: (previous) => previous,
  });
  const refreshResults = () => results.refetch({ cancelRefetch: false });
  const serverPaged = typeof results.data?.total === "number";
  useEffect(() => { setServerTotal(typeof results.data?.total === "number" ? results.data.total : null); }, [results.data?.total]);
  const { openNew, openEdit, editor } = useResultTableEditor();

  const providersReady = (tableProviders.data?.items.length ?? 0) > 0;
  const configuration = tableConfig.data?.configuration || null;
  const tables = useMemo(() => tableConfig.data?.tables ?? (configuration ? [configuration] : []), [tableConfig.data?.tables, configuration]);
  const enabledTables = tables.filter((table) => table.enabled !== false);
  const multiTable = enabledTables.length > 1;
  const configured = enabledTables.length > 0;
  const summary = results.data?.summary;
  const rows = useMemo(() => results.data?.items ?? [], [results.data?.items]);
  const columns = resultColumns(enabledTables, rows);
  const activeTable = multiTable ? tableFilter : ALL;
  const visibleResults = useMemo(() => {
    if (serverPaged) return rows;
    const term = resultSearch.trim().toLowerCase();
    return rows.filter((item) => (resultStatus === ALL || item.status === resultStatus) && (severity === ALL || String(item.severity || "").toLowerCase() === severity) && (activeTable === ALL || item.tableId === activeTable) && (!term || `${item.name} ${item.checkId} ${item.dataset} ${item.field} ${item.rule} ${item.table || ""}`.toLowerCase().includes(term)));
  }, [rows, resultStatus, severity, activeTable, resultSearch, serverPaged]);
  const sourceLabel = providersReady ? (multiTable ? `${enabledTables.length} result tables` : capitalise(configuration?.provider) || tableProviders.data?.items[0]?.name || "Connected") : "No connection";
  const readFrom = multiTable ? enabledTables.map(fullName).join(", ") : configuration ? fullName(configuration) : null;
  const platformName = capitalise(configuration?.provider) || tableProviders.data?.items[0]?.name || "The result table";
  const passed = summary?.passed ?? 0;
  const total = summary?.total ?? 0;

  // Tell the agent what is on screen: the checks that need attention, the open one, the filters.
  const attention = visibleResults.filter((item) => item.status === "failed" || item.status === "warning").slice(0, 50);
  useAgentScreen({
    visible: attention.map((item) => (multiTable && item.table ? `${item.checkId} (${item.table})` : item.checkId)),
    open: selectedResult ? { kind: "dq_check", id: selectedResult.checkId, title: selectedResult.name } : null,
    summary: configured ? `Data quality ${periodLabel}: ${total} checks, ${summary?.failed ?? 0} failed, ${summary?.warning ?? 0} warnings${multiTable ? ` across ${enabledTables.length} result tables` : readFrom ? ` from ${readFrom}` : ""}${[resultStatus !== ALL ? `status ${resultStatus}` : "", severity !== ALL ? `severity ${severity}` : "", activeTable !== ALL ? `table ${tableLabel(tables.find((table) => table.id === activeTable) || { resultTable: activeTable })}` : "", resultSearch.trim() ? `search "${resultSearch.trim()}"` : ""].filter(Boolean).map((part, index) => `${index ? ", " : "; filtered by "}${part}`).join("")}` : "Data quality: no result table set up",
  });

  const menu = [
    ...tables.slice(0, 6).map((table) => ({ label: tables.length === 1 ? "Edit result table" : `Edit ${tableLabel(table)}`, icon: Pencil, onSelect: () => openEdit(table) })),
    { label: "Add result table", icon: Plus, onSelect: openNew, divider: tables.length > 0 },
    tables.length > 1 ? { label: "All result tables", icon: Settings2, onSelect: () => navigate("/settings?tab=data-quality") } : null,
  ];

  return <OpsPage title="Data quality" count={providersReady ? sourceLabel : "Not connected"} actions={<RefreshButton autoRefresh onClick={() => void Promise.all([tableProviders.refetch({ cancelRefetch: false }), tableConfig.refetch({ cancelRefetch: false }), refreshResults()])} busy={results.isFetching || tableConfig.isFetching || tableProviders.isFetching} updatedAt={results.data?.fetchedAt} />} primary={configured || tableConfig.isPending ? undefined : <Button variant="primary" size="sm" onClick={openNew}><Settings2 className="h-4 w-4" />Set up result table</Button>} menu={configured ? menu : undefined}>
    <div className="space-y-4">
      <div className="flex items-center gap-3"><TimeRangePicker value={range} onChange={setRange} /></div>
      {!providersReady && !tableProviders.isPending ? (
        <DisconnectedRow status="Not connected" text="No verified Databricks or Snowflake connection. Results cannot be read until one is connected." actionLabel="Fix connection" to="/connectors" />
      ) : null}

      {readFrom ? <p className="truncate text-[13px] text-ink-4" title={readFrom}>Read from <span className="font-mono text-[12.5px] text-ink-3">{multiTable ? `${enabledTables.length} result tables` : readFrom}</span></p> : null}

      <StatStrip columns={4}>
        <StatCell label="Checks run" value={configured ? total : "—"} suffix={configured ? periodLabel : undefined} hint={HINT.run} to="/data-quality" active={configured && resultStatus === ALL} />
        <StatCell label="Passed" value={configured ? passed : "—"} suffix={configured && total ? `of ${total}` : undefined} hint={HINT.passed} tone="emerald" to="/data-quality?status=passed" active={resultStatus === "passed"} />
        <StatCell label="Warnings" value={configured ? summary?.warning ?? 0 : "—"} suffix={configured && total ? `of ${total}` : undefined} hint={HINT.warning} tone="amber" to="/data-quality?status=warning" active={resultStatus === "warning"} />
        <StatCell label="Failed" value={configured ? summary?.failed ?? 0 : "—"} suffix={configured && total ? `of ${total}` : undefined} hint={HINT.failed} tone="rose" to="/data-quality?status=failed" active={resultStatus === "failed"} />
      </StatStrip>
      {results.error && results.data ? <p role="alert" className="text-rose-600">Could not refresh results. The previous snapshot is shown.</p> : null}
      <ResultsCard results={results.data} pending={results.isPending || results.isPlaceholderData} error={results.data ? null : results.error} configured={configured} rows={visibleResults} allRows={rows} filters={{ search: resultSearch, status: resultStatus, severity, table: activeTable }} tables={multiTable ? enabledTables : []} platformName={platformName} periodLabel={periodLabel} columns={columns} onSelect={setSelectedResult} serverPager={serverPaged ? pager.pagerProps : null} />
    </div>

    {editor}
    <Sheet open={Boolean(selectedResult)} onOpenChange={(open) => !open && setSelectedResult(null)}><SheetContent side="right" className="w-full sm:max-w-2xl">{selectedResult ? <ResultDetail item={selectedResult} columns={columns} onClose={() => setSelectedResult(null)} /> : null}</SheetContent></Sheet>
  </OpsPage>;
}

type ResultSortKey = "name" | "severity" | "status" | "dataset" | "table" | "ran";
const RESULT_COMPARATORS = {
  name: byText<DataQualityResult>((item) => item.name),
  severity: byPriority<DataQualityResult>((item) => item.severity),
  status: byStatus<DataQualityResult>((item) => item.status),
  dataset: byText<DataQualityResult>((item) => item.dataset),
  table: byText<DataQualityResult>((item) => item.table || ""),
  ran: byText<DataQualityResult>((item) => item.executedAt || ""),
};

/** The result filters as they stand in the URL; "all" for a filter that is off. */
interface ResultFilters { search: string; status: string; severity: string; table: string }

function ResultsCard({ results, pending, error, configured, rows, allRows, filters, tables, platformName, periodLabel, columns, onSelect, serverPager }: {
  results?: DataQualityMonitorResponse; pending: boolean; error: unknown; configured: boolean; rows: DataQualityResult[]; allRows: DataQualityResult[];
  /** Set when the server pages: the rows are one page of the filtered results. */
  serverPager: ReturnType<typeof usePager>["pagerProps"] | null;
  filters: ResultFilters;
  /** Enabled result tables; the table filter and column appear only when there are two or more. */
  tables: DataQualityConfiguration[];
  /** Names the platform in the one-sentence read error. */
  platformName: string; periodLabel: string; columns: ResultColumns; onSelect: (item: DataQualityResult) => void;
}) {
  const urlFilters = useUrlFilters();
  const { search, status, severity, table } = filters;
  // A page holds only some results, so the choices are the known ones rather than what this page happens to show.
  const statuses = serverPager ? STATUS_CHOICES : [...new Set(allRows.map((item) => item.status))].sort();
  const severities = serverPager ? SEVERITY_CHOICES : [...new Set(allRows.map((item) => String(item.severity || "").toLowerCase()).filter(Boolean))];
  const localPager = usePager(rows.length, { resetKey: JSON.stringify(filters) });
  const pageRows = serverPager ? rows : localPager.slice(rows);
  const windowTotal = results?.summary.total ?? allRows.length;
  const unreadable = (results?.sources || []).filter((source) => source.status !== "ok");
  const unavailable = results?.source?.mode === "unavailable";
  const filtered = Number(status !== ALL) + Number(severity !== ALL) + Number(table !== ALL) + Number(Boolean(search.trim()));
  // Landing on the failed checks (the Overview tile) when none failed is good news, not an empty filter.
  const noFailures = status === "failed" && filtered === 1 && !rows.length && windowTotal > 0 && (results?.summary.failed ?? 0) === 0;
  const warnings = results?.summary.warning ?? 0;
  if (!configured && !pending) return <Card><CompactEmptyState className="justify-center px-4 py-10">No result table yet</CompactEmptyState></Card>;
  // overflow-clip, not -hidden: `hidden` would make the card a scroll container and the sticky toolbar could never pin.
  return <Card className="overflow-clip">
    <ListToolbar placement="card" className="border-b border-line px-4 py-3">
      <SearchInput className="min-w-[220px] flex-1" label="Search results" placeholder="Search checks or datasets" value={search} onValueChange={(value) => urlFilters.set("q", value)} />
      <FilterSelect label="Status" plural="statuses" value={status} onChange={(value) => urlFilters.set("status", value)} options={withCurrent(statuses, status).map((item) => ({ value: item, label: capitalise(item.replace(/_/g, " ")) }))} />
      <FilterSelect label="Severity" plural="severities" value={severity} onChange={(value) => urlFilters.set("severity", value)} options={severities.map((item) => ({ value: item, label: capitalise(item) }))} />
      {tables.length > 1 ? <FilterSelect label="Table" plural="tables" value={table} onChange={(value) => urlFilters.set("table", value)} className="w-[180px]" options={tables.map((item) => ({ value: item.id || item.resultTable, label: tableLabel(item) }))} /> : null}
      {filtered ? <Button variant="ghost" size="sm" onClick={() => urlFilters.clear("status", "severity", "table", "q")}><X className="h-3.5 w-3.5" />Clear filters</Button> : null}
    </ListToolbar>
    {pending ? <TableSkeleton rows={4} className="border-0" /> : error ? <div role="alert" className="p-5 text-[13.5px] text-ink-2">{plainConnectionReason(error instanceof Error ? error.message : null, platformName)} <Link to="/connectors" className="font-semibold text-brand hover:text-brand-hover">Fix connection</Link></div> : <>
      {unavailable ? <div role="alert" className="break-words border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-900">{results?.source?.reason || "The configured result table is unavailable."}</div> : unreadable.length ? <div role="alert" className="break-words border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-900">{unreadable.map((source) => `${source.table}: ${source.reason || "not read"}`).join(" · ")}</div> : null}
      {noFailures
        ? <EmptyState illustration="checks" title={`All checks passed ${periodLabel}`} body={`${windowTotal} ${windowTotal === 1 ? "check" : "checks"} ran${warnings ? `, ${warnings} with ${warnings === 1 ? "a warning" : "warnings"}` : ""}; none failed.`} />
        : <ResultsTable rows={pageRows} showTable={tables.length > 1} columns={columns} onSelect={onSelect} emptyText={windowTotal ? "No results match these filters" : `No results ${periodLabel}`} />}
      {serverPager ? <Pager {...serverPager} noun="results" /> : <Pager {...localPager.pagerProps} noun="results" />}
      {filtered && windowTotal ? <p className="border-t border-line px-4 py-2 text-[12.5px] text-ink-4">{serverPager ? serverPager.total : rows.length} of {windowTotal} results match</p> : null}
    </>}
  </Card>;
}

function ResultsTable({ rows, showTable, columns, onSelect, emptyText }: { rows: DataQualityResult[]; showTable: boolean; columns: ResultColumns; onSelect: (item: DataQualityResult) => void; emptyText: string }) {
  const { rows: sorted, sort, toggle } = useTableSort<DataQualityResult, ResultSortKey>(rows, RESULT_COMPARATORS, { key: "status", dir: "asc" });
  const colSpan = 5 + Number(showTable) + Number(columns.dataset) + Number(columns.rule) + Number(columns.failedRows);
  return (
    <OpsTable>
      <OpsHead>
        <OpsTh sortKey="status" sort={sort} onSort={toggle} width="150px">Status</OpsTh>
        <OpsTh sortKey="name" sort={sort} onSort={toggle} width={columns.rule ? "240px" : undefined}>Check</OpsTh>
        {showTable ? <OpsTh sortKey="table" sort={sort} onSort={toggle} width="150px">Table</OpsTh> : null}
        {columns.dataset ? <OpsTh sortKey="dataset" sort={sort} onSort={toggle} width={columns.rule ? "200px" : "260px"}>Dataset</OpsTh> : null}
        {columns.rule ? <OpsTh>Rule</OpsTh> : null}
        {columns.failedRows ? <OpsTh width="110px" align="right">Failed rows</OpsTh> : null}
        <OpsTh sortKey="ran" sort={sort} onSort={toggle} width="130px">Last run</OpsTh>
        <OpsTh sortKey="severity" sort={sort} onSort={toggle} width="130px">Severity</OpsTh>
        <OpsTh width="150px" align="right"><span className="sr-only">Actions</span></OpsTh>
      </OpsHead>
      <OpsBody>
        {sorted.map((item, index) => {
          const href = resultHref(item);
          const ticketId = item.ticket?.ticketId || item.routing?.ticketId;
          return (
            <OpsRow key={`${item.tableId || ""}:${item.id}:${item.executedAt}`} index={index} onOpen={() => onSelect(item)}>
              <OpsTd><OperationalStatus value={item.status} /></OpsTd>
              <OpsTd><TitleCell title={item.name} subtitle={item.checkId} onOpen={() => onSelect(item)} /></OpsTd>
              {showTable ? <OpsTd muted className="max-w-[160px]"><span className="block truncate" title={item.table || undefined}>{item.table || "—"}</span></OpsTd> : null}
              {columns.dataset ? <OpsTd mono muted className="max-w-[280px]"><span className="block truncate" title={[item.dataset, item.field].filter(Boolean).join(".") || undefined}>{item.dataset || "—"}{item.field ? <span className="text-ink-5">.{item.field}</span> : null}</span></OpsTd> : null}
              {columns.rule ? <OpsTd className="max-w-[420px]"><p className="truncate text-ink-3" title={item.rule || undefined}>{item.rule || "—"}</p></OpsTd> : null}
              {columns.failedRows ? <OpsTd align="right" muted className="tabular-nums">{Number.isFinite(item.failedRows) ? item.failedRows.toLocaleString() : "—"}</OpsTd> : null}
              <OpsTd muted><span title={item.executedAt ? formatAbsoluteTime(item.executedAt) : undefined}>{item.executedAt ? formatRelativeTime(item.executedAt) : "—"}</span></OpsTd>
              <OpsTd><PriorityBadge priority={item.severity} variant="label" /></OpsTd>
              <OpsTd align="right">
                <span className="inline-flex items-center justify-end gap-1.5">
                  {item.taskId ? <Button asChild size="xs" variant="outline" className="border border-line"><Link to={`/tasks/${encodeURIComponent(item.taskId)}`} onClick={(event) => event.stopPropagation()} title={`Open task ${item.taskId}`}>Task</Link></Button> : null}
                  {href ? <Button asChild size="xs" variant="outline" className="border border-line"><Link to={href}>{ticketId}</Link></Button> : null}
                  <AskSonicButton item={item} />
                </span>
              </OpsTd>
            </OpsRow>
          );
        })}
        {!sorted.length ? <OpsTableEmpty colSpan={colSpan}>{emptyText}</OpsTableEmpty> : null}
      </OpsBody>
    </OpsTable>
  );
}

function ResultDetail({ item, columns, onClose }: { item: DataQualityResult; columns: ResultColumns; onClose: () => void }) {
  const href = resultHref(item);
  const ticketId = item.ticket?.ticketId || item.routing?.ticketId;
  return (
    <>
      <SheetHeader>
        <div className="flex flex-wrap items-center gap-2"><OperationalStatus value={item.status} />{item.severity ? <span className="text-[13px] text-ink-4">{capitalise(item.severity)} severity</span> : null}</div>
        <SheetTitle className="mt-2 text-[18px] leading-snug">{item.name}</SheetTitle>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          <Fact label="Check" value={item.checkId} mono />
          {columns.dataset ? <Fact label="Dataset" value={[item.dataset || "Unknown", item.field].filter(Boolean).join(".")} mono /> : null}
          {columns.failedRows ? <Fact label="Failed rows" value={String(item.failedRows ?? "—")} /> : null}
          <Fact label="Ran" value={item.executedAt ? formatAbsoluteTime(item.executedAt) : "—"} />
          {item.table ? <Fact label="Result table" value={item.table} mono /> : null}
          {ticketId ? <Fact label="Ticket" value={ticketId} mono /> : null}
          {item.taskId ? <Fact label="Task" value={item.taskId} mono /> : null}
        </dl>
      </SheetHeader>
      <div className="space-y-5 px-6 py-5">
        {columns.rule ? <Block title="Rule" content={item.rule || "No rule was supplied."} mono /> : null}
        <Block title="What was observed" content={item.message || "No message was supplied."} />
        {item.recommendedFix ? <Block title="Recommended fix" content={item.recommendedFix} /> : null}
        <div className="flex flex-wrap items-center gap-2">
          <AskSonicButton item={item} variant={item.status === "failed" ? "investigate" : "outline"} onBeforeAsk={onClose} />
          {href ? <Button asChild variant="outline" size="sm" className="border border-line"><Link to={href}><TicketIcon className="h-3.5 w-3.5" aria-hidden="true" />Open ticket {ticketId}</Link></Button> : null}
          {item.taskId ? <Button asChild variant="outline" size="sm" className="border border-line"><Link to={`/tasks/${encodeURIComponent(item.taskId)}`}><ListTodo className="h-3.5 w-3.5" aria-hidden="true" />Open task</Link></Button> : null}
        </div>
      </div>
    </>
  );
}

function Block({ title, content, mono = false }: { title: string; content: string; mono?: boolean }) {
  return <section><h3 className="text-[12px] font-medium text-ink-5">{title}</h3><p className={`mt-1.5 whitespace-pre-wrap break-words text-[14px] leading-6 text-ink-2 ${mono ? "font-mono text-[13px]" : ""}`}>{content}</p></section>;
}

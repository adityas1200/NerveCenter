import { useQuery } from "@tanstack/react-query";
import { Plus, UserRound, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { queryKeys } from "@/api/queryKeys";
import { ticketsApi, type TicketScope, type TicketListQuery } from "@/api/tickets";
import { type Ticket, type TicketAppStatus } from "@/api/types";
import { APP_STATUS_LABEL, AppStatusPill } from "@/components/ops/AgentStatePill";
import { AskAgentButton } from "@/components/ops/AskAgentButton";
import { BrandLogo, JiraLogo, ServiceNowLogo } from "@/components/ops/BrandLogo";
import { AGENT_NAME, useAgentScreen, useAskSonic } from "@/components/ops/agentPanelContext";
import { OpsBody, OpsHead, OpsRow, OpsTable, OpsTableEmpty, OpsTd, OpsTh, TitleCell } from "@/components/ops/OpsTable";
import { EmptyState } from "@/components/ops/EmptyState";
import { ListToolbar } from "@/components/ops/ListToolbar";
import { Pager } from "@/components/ops/Pager";
import { OpsPage } from "@/components/ops/OpsPage";
import { PersonName } from "@/components/ops/PersonAvatar";
import { PriorityBadge, priorityText } from "@/components/ops/PriorityBadge";
import { RefreshButton } from "@/components/ops/RefreshButton";
import { StatCell, StatStrip } from "@/components/ops/StatStrip";
import { QueryState } from "@/components/ops/StatePanels";
import { TimeRangePicker } from "@/components/ops/TimeRangePicker";
import { Button, Card, RelativeTime, Tabs, TabsList, TabsTrigger, SearchInput } from "@/components/ui";
import type { SortState } from "@/lib/tableSort";
import { useTimeRange } from "@/lib/useTimeRange";
import { TicketDetailSheet } from "./TicketDetailSheet";
import { NewTicketDialog, SyncJiraDialog, SyncServiceNowDialog } from "./TicketDialogs";
import { useAssignToMe } from "./useAssignToMe";
import { SOURCE_LABEL, assigneeName, humanize, isClosed, parseFilter, sourceKey, type SourceKey } from "./ticketFields";
import { FilterSelect } from "@/components/ops/FilterSelect";
import { useUrlFilters, withCurrent } from "@/lib/useUrlFilters";
import { usePager } from "@/lib/usePager";
import { FRESH } from "@/api/queryPolicy";

/**
 * The ticket list: every ticket from ServiceNow, Jira and NerveCenter in one table, with the same four
 * statuses whatever the source (Open, In progress, Waiting on you, Closed). Row click opens the ticket,
 * where Sonic's finding lives.
 *
 * Filters live in the URL so Overview tiles can land on the exact list behind a number. The four
 * dropdown filters are `priority`, `status`, `assignee` and `source`; three more are URL-only and set
 * by tiles: `resolved=sonic` (closed after the agent made a change), `kind` (pipeline, data_quality,
 * access, other) and `category` (a ticket category; `data_quality` also matches check-sourced tickets).
 */

const FILTER_KEYS = ["priority", "status", "assignee", "source"] as const;
type FilterKey = (typeof FILTER_KEYS)[number];
const FILTER_LABELS: Record<FilterKey, string> = { priority: "Priority", status: "Status", assignee: "Assignee", source: "Source" };
const FILTER_PLURALS: Record<FilterKey, string> = { priority: "priorities", status: "statuses", assignee: "assignees", source: "sources" };
/** Filters without a dropdown; Overview tiles set them and "Clear" removes them. */
const LINK_FILTER_KEYS = ["resolved", "kind", "category"] as const;
const appStatusOf = (ticket: Ticket): TicketAppStatus => ticket.appStatus || (isClosed(ticket) ? "closed" : "open");
/** The agent's credit was `dobby` before the rename; old links keep working. */
const AGENT_RESOLVED_VALUES = new Set(["sonic", "dobby"]);
const FIXED_WITH_AGENT = `Fixed with ${AGENT_NAME}`;

function renderOption(key: FilterKey, value: string): string {
  if (key === "priority") return priorityText(value);
  if (key === "source") return SOURCE_LABEL[value as SourceKey] ?? humanize(value);
  if (key === "status") return APP_STATUS_LABEL[value as TicketAppStatus] ?? humanize(value);
  return value;
}

/** The source's brand mark, or a person glyph for a ticket someone raised by hand (no brand to show). */
function SourceIcon({ source, className }: { source: SourceKey; className?: string }) {
  if (source === "manual") return <UserRound className={className} aria-hidden="true" />;
  return <BrandLogo brand={source} className={className} />;
}

type SortKey = "priority" | "title" | "source" | "assignee" | "status" | "updated";

export function TicketsPage() {
  const { ticketId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const urlFilters = useUrlFilters();
  const { params: searchParams } = urlFilters;
  const { range, setRange, bounds, label: periodLabel } = useTimeRange();
  const rawScope = searchParams.get("scope");
  const scope: TicketScope = rawScope === "closed" || rawScope === "all" ? rawScope : "active";
  const search = searchParams.get("q") || "";
  const filters = useMemo(() => Object.fromEntries(FILTER_KEYS.map((key) => [key, searchParams.get(key) || "all"])) as Record<FilterKey, string>, [searchParams]);
  // "all" is the default for filters but a real choice for scope, where the default is "active".
  const setParam = (key: string, value: string) => urlFilters.set(key, value, key === "scope" ? "active" : "all");
  const clearFilters = () => {
    const next = new URLSearchParams();
    if (scope !== "active") next.set("scope", scope);
    // The window and the page size are not filters; clearing keeps them.
    for (const key of ["range", "size"]) { const value = searchParams.get(key); if (value) next.set(key, value); }
    urlFilters.replaceAll(next);
  };
  const linkFilters = useMemo(() => Object.fromEntries(LINK_FILTER_KEYS.map((key) => [key, searchParams.get(key)])) as Record<(typeof LINK_FILTER_KEYS)[number], string | null>, [searchParams]);
  const onlyAgentResolved = AGENT_RESOLVED_VALUES.has(String(linkFilters.resolved || ""));
  const activeFilters = FILTER_KEYS.filter((key) => filters[key] !== "all").length + LINK_FILTER_KEYS.filter((key) => Boolean(linkFilters[key])).length + (search.trim() ? 1 : 0);
  const [createOpen, setCreateOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [jiraOpen, setJiraOpen] = useState(false);

  const [sort, setSort] = useState<SortState<SortKey>>({ key: "priority", dir: "asc" });
  const resetKey = JSON.stringify({ scope, search: search.trim(), filters, linkFilters, range, sort });
  const requestedSize = [10, 25, 50, 100].includes(Number(searchParams.get("size"))) ? Number(searchParams.get("size")) : 10;
  const pageNumber = Number(searchParams.get("page"));
  const requestedPage = Number.isSafeInteger(pageNumber) && pageNumber > 0 ? Math.min(pageNumber, Math.floor(Number.MAX_SAFE_INTEGER / requestedSize)) : 1;
  const listQuery: TicketListQuery = {
    scope, limit: requestedSize, offset: (requestedPage - 1) * requestedSize,
    sort: sort.key, dir: sort.dir, from: bounds.from, to: bounds.to, q: search.trim(),
    priority: filters.priority, appStatus: filters.status, assignee: filters.assignee, source: filters.source,
    resolved: linkFilters.resolved, kind: linkFilters.kind, category: linkFilters.category,
  };
  const query = useQuery({ queryKey: [...queryKeys.tickets.lists(), listQuery], queryFn: ({ signal }) => ticketsApi.list(listQuery, signal), refetchInterval: false, refetchIntervalInBackground: false });
  const pager = usePager(query.data?.total ?? Number.MAX_SAFE_INTEGER, { resetKey });
  useEffect(() => {
    if (query.data && requestedPage > pager.page) pager.pagerProps.onChange(pager.page);
  }, [query.data, requestedPage, pager.page, pager.pagerProps]);
  const serviceNow = useQuery({ queryKey: queryKeys.serviceNow.status, queryFn: ({ signal }) => ticketsApi.serviceNow.status(signal) });
  const jira = useQuery({ queryKey: queryKeys.jira.status, queryFn: ({ signal }) => ticketsApi.jira.status(signal), staleTime: FRESH.long });
  const claim = useAssignToMe();
  const tickets = query.data?.items || [];
  const meta = query.data?.meta;
  const options = meta?.options || { priority: [], status: [], assignee: [], source: [] };
  const people = meta?.people || [];
  const toggle = (key: SortKey) => setSort(current => current.key === key ? { key, dir: current.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" });
  const visible = tickets;
  const openTicket = (id: string) => navigate({ pathname: `/tickets/${encodeURIComponent(id)}`, search: location.search });
  // No source to read tickets from: neither ServiceNow nor Jira is configured and nothing was created here.
  const noSource = Boolean(query.data) && meta?.scoped === 0 && serviceNow.isSuccess && jira.isSuccess && !serviceNow.data?.configured && !jira.data?.configured;
  useAgentScreen({
    visible: visible.slice(0, 100).map((ticket) => ticket.externalReference?.number ? `${ticket.ticketId} (${ticket.externalReference.number})` : ticket.ticketId),
    open: ticketId ? { kind: "ticket", id: ticketId, title: tickets.find((ticket) => ticket.ticketId === ticketId)?.title } : null,
    summary: `${scope === "active" ? "open" : scope} tickets${activeFilters ? `, ${activeFilters} filter${activeFilters === 1 ? "" : "s"} applied` : ""}; ${meta?.open || 0} open, ${meta?.waitingOnYou || 0} waiting on the reader`,
  });
  const rangeParam = searchParams.get("range");
  const withRange = (params: string) => { const parts = [params, rangeParam ? `range=${encodeURIComponent(rangeParam)}` : ""].filter(Boolean); return `/tickets${parts.length ? `?${parts.join("&")}` : ""}`; };
  const priorityFilter = parseFilter(filters.priority);
  const isHighFilter = Boolean(priorityFilter && priorityFilter.size === 2 && priorityFilter.has("critical") && priorityFilter.has("high"));

  return (
    <OpsPage
      title="Tickets"
      count={`${meta?.open || 0} open`}
      actions={<RefreshButton autoRefresh onClick={() => void query.refetch({ cancelRefetch: false })} busy={query.isFetching} />}
      primary={<Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" />New ticket</Button>}
      menu={[
        { label: "Sync from ServiceNow", icon: ServiceNowLogo, disabled: !serviceNow.data?.ready, onSelect: () => setSyncOpen(true) },
        { label: "Sync from Jira", icon: JiraLogo, disabled: !jira.data?.ready, onSelect: () => setJiraOpen(true) },
      ]}
    >
      <QueryState query={query}>
        <div className="space-y-4">
          <div className="flex items-center gap-3"><TimeRangePicker value={range} onChange={setRange} /></div>
          <StatStrip columns={4}>
            <StatCell label="Open tickets" value={meta?.open || 0} hint="Tickets that are not resolved or closed yet, from every connected source." to={withRange("")} active={scope === "active" && !activeFilters} />
            <StatCell label="High priority open" value={meta?.highOpen || 0} hint="Open tickets at priority 1 or 2." tone="rose" to="/tickets?priority=critical,high" active={isHighFilter} />
            <StatCell label="Waiting on you" value={meta?.waitingOnYou || 0} hint={`Open tickets where ${AGENT_NAME} paused for an approval or an answer.`} tone="amber" to="/tickets?status=waiting_on_you" active={filters.status === "waiting_on_you"} />
            <StatCell label={FIXED_WITH_AGENT} value={meta?.resolved || 0} suffix={`of ${meta?.closed || 0} closed ${periodLabel}`} hint={`Tickets closed in this period after ${AGENT_NAME} made at least one change while working on them.`} tone="emerald" to={withRange("scope=closed&resolved=sonic")} active={onlyAgentResolved} />
          </StatStrip>

          {/* overflow-clip, not -hidden: `hidden` would make the card a scroll container and the sticky toolbar could never pin. */}
          <Card className="overflow-clip">
            <ListToolbar placement="card" className="border-b border-line px-4 py-3">
              <SearchInput id="ticket-search" className="min-w-[220px] flex-1" label="Search tickets" value={search} onValueChange={(value) => setParam("q", value)} />
              <Tabs value={scope} onValueChange={(value) => setParam("scope", value)}>
                <TabsList aria-label="Ticket scope">
                  <TabsTrigger value="active">Open <span className="ml-1 text-ink-5">{meta?.open || 0}</span></TabsTrigger>
                  <TabsTrigger value="closed">Closed <span className="ml-1 text-ink-5">{meta?.closed || 0}</span></TabsTrigger>
                  <TabsTrigger value="all">All <span className="ml-1 text-ink-5">{(meta?.open || 0) + (meta?.closed || 0)}</span></TabsTrigger>
                </TabsList>
              </Tabs>
              {FILTER_KEYS.map((key) => (
                <TicketFilter key={key} filterKey={key} value={filters[key]} values={options[key]} onChange={(value) => setParam(key, value)} />
              ))}
              {activeFilters ? <Button variant="ghost" size="sm" onClick={clearFilters}><X className="h-3.5 w-3.5" />Clear {activeFilters}</Button> : null}
            </ListToolbar>
            {noSource ? (
              <EmptyState
                illustration="tasks"
                title="No ticket source connected"
                body={`Tickets from ServiceNow, Jira and NerveCenter show here once a source is connected; ${AGENT_NAME} picks them up from there.`}
                action={<Button asChild size="sm" variant="primary"><Link to="/connectors">Connect ServiceNow or Jira</Link></Button>}
              />
            ) : (
              <TicketTable
                tickets={visible}
                total={query.data?.total || 0}
                sort={sort}
                onSort={toggle}
                page={pager.page}
                size={pager.size}
                onPage={pager.pagerProps.onChange}
                onSize={pager.pagerProps.onSizeChange}
                onOpen={openTicket}
                onClaim={(id) => claim.mutate(id)}
                claiming={claim.isPending}
                empty={meta?.scoped ? "No tickets match these filters" : scope === "closed" ? `Nothing closed ${periodLabel}` : "No open tickets"}
              />
            )}
            {query.data && query.data.total !== meta?.scoped ? <p className="border-t border-line px-4 py-2 text-[12.5px] text-ink-4">{query.data.total} of {meta?.scoped || 0} {scope === "active" ? "open" : scope === "closed" ? "closed" : ""} tickets</p> : null}
          </Card>
        </div>
      </QueryState>
      <TicketDetailSheet ticketId={ticketId} people={people} onClose={() => navigate({ pathname: "/tickets", search: withoutActivityPage(location.search) })} />
      <NewTicketDialog open={createOpen} onOpenChange={setCreateOpen} people={people} />
      <SyncServiceNowDialog open={syncOpen} onOpenChange={setSyncOpen} status={serviceNow.data} />
      <SyncJiraDialog open={jiraOpen} onOpenChange={setJiraOpen} status={jira.data} />
    </OpsPage>
  );
}

/** The ticket's activity page belongs to the open ticket; the list keeps its own page when the ticket closes. */
function withoutActivityPage(search: string): string {
  const params = new URLSearchParams(search);
  params.delete("activityPage");
  params.delete("activitySize");
  const text = params.toString();
  return text ? `?${text}` : "";
}

function TicketTable({ tickets, total, sort, onSort, page, size, onPage, onSize, onOpen, onClaim, claiming, empty }: { tickets: Ticket[]; total: number; sort: SortState<SortKey>; onSort: (key: SortKey) => void; page: number; size: number; onPage: (page: number) => void; onSize?: (size: number) => void; onOpen: (id: string) => void; onClaim: (id: string) => void; claiming: boolean; empty: ReactNode }) {
  const rows = tickets;
  const askSonic = useAskSonic();
  const askAgent = (ticket: Ticket) => askSonic({ kind: "ticket", id: ticket.ticketId, title: ticket.title }, `Tell me about ticket ${ticket.externalReference?.number || ticket.ticketId} and what I should do next`);
  return (
    <>
    <OpsTable>
      <OpsHead>
        <OpsTh sortKey="priority" sort={sort} onSort={onSort} width="80px">Priority</OpsTh>
        <OpsTh width="116px">Ticket</OpsTh>
        <OpsTh sortKey="title" sort={sort} onSort={onSort}>Title</OpsTh>
        <OpsTh sortKey="source" sort={sort} onSort={onSort} width="140px">Source</OpsTh>
        <OpsTh sortKey="assignee" sort={sort} onSort={onSort} width="168px">Assignee</OpsTh>
        <OpsTh sortKey="status" sort={sort} onSort={onSort} width="140px">Status</OpsTh>
        <OpsTh sortKey="updated" sort={sort} onSort={onSort} width="124px">Updated</OpsTh>
        <OpsTh width="64px" align="right"><span className="sr-only">Actions</span></OpsTh>
      </OpsHead>
      <OpsBody>
        {rows.map((ticket, index) => (
          <OpsRow key={ticket.ticketId} index={index} onOpen={() => onOpen(ticket.ticketId)}>
            <OpsTd><PriorityBadge priority={ticket.priority} /></OpsTd>
            <OpsTd mono muted><span title={ticket.externalReference?.number || ticket.ticketId}>{ticket.externalReference?.number || ticket.ticketId}</span></OpsTd>
            <OpsTd><TitleCell title={ticket.title || ticket.failureSummary || "Untitled ticket"} onOpen={() => onOpen(ticket.ticketId)} /></OpsTd>
            <OpsTd muted nowrap><span className="inline-flex items-center gap-1.5"><SourceIcon source={sourceKey(ticket)} className="h-3.5 w-3.5 shrink-0 text-ink-4" />{SOURCE_LABEL[sourceKey(ticket)]}</span></OpsTd>
            {/* The owner, or for an unowned open ticket the one-click way to become it. */}
            <OpsTd muted>{assigneeName(ticket) ? <PersonName name={assigneeName(ticket) as string} /> : !isClosed(ticket) ? <Button size="xs" variant="outline" disabled={claiming} onClick={(event) => { event.stopPropagation(); onClaim(ticket.ticketId); }}>Assign to me</Button> : <span className="text-ink-5">No owner</span>}</OpsTd>
            <OpsTd><AppStatusPill status={appStatusOf(ticket)} sourceStatus={ticket.sourceStatus} /></OpsTd>
            <OpsTd muted nowrap>{ticket.updatedAt || ticket.createdAt ? <RelativeTime value={ticket.updatedAt || ticket.createdAt} className="tabular-nums" /> : <span className="text-ink-5">—</span>}</OpsTd>
            <OpsTd align="right">
              <AskAgentButton label={`Ask ${AGENT_NAME} about this ticket`} onClick={(event) => { event.stopPropagation(); askAgent(ticket); }} />
            </OpsTd>
          </OpsRow>
        ))}
        {!rows.length ? <OpsTableEmpty colSpan={8}>{empty}</OpsTableEmpty> : null}
      </OpsBody>
    </OpsTable>
    <Pager page={page} total={total} size={size} onChange={onPage} sizes={[10,25,50,100]} onSizeChange={onSize} noun="tickets" />
    </>
  );
}

function TicketFilter({ filterKey, value, values, onChange }: { filterKey: FilterKey; value: string; values: string[]; onChange: (value: string) => void }) {
  const display = (item: string) => item.includes(",") ? item.split(",").map((part) => renderOption(filterKey, part.trim())).join(", ") : renderOption(filterKey, item);
  const options = [
    ...(filterKey === "assignee" ? [{ value: "__none", label: "No owner" }] : []),
    ...withCurrent(values, value).filter((item) => item !== "__none").map((item) => ({ value: item, label: display(item) })),
  ];
  return <FilterSelect label={FILTER_LABELS[filterKey]} plural={FILTER_PLURALS[filterKey]} value={value} onChange={onChange} options={options} className="w-[136px]" />;
}

import { refreshAfterWrite } from "@/lib/refreshAfterWrite";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { useId, useMemo, useState, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { CONNECTION_KIND_LABEL, CONNECTOR_STATE_LABEL, connectorKeys, connectorsApi, type Connector, type ConnectorState } from "@/api/connectors";
import { knowledgeKeys } from "@/api/library";
import { settingsApi, settingsKeys } from "@/api/settings";
import { useIsAdmin, useMe } from "@/auth/rbac";
import { AGENT_NAME, useAgentScreen } from "@/components/ops/agentPanelContext";
import { ListToolbar } from "@/components/ops/ListToolbar";
import { OpsPage } from "@/components/ops/OpsPage";
import { OverflowMenu } from "@/components/ops/OverflowMenu";
import { Pager } from "@/components/ops/Pager";
import { RefreshButton } from "@/components/ops/RefreshButton";
import { QueryState } from "@/components/ops/StatePanels";
import { useAction } from "@/lib/useAction";
import { GRID_PAGE_SIZES, usePager } from "@/lib/usePager";
import { Button, Card, CodeBlock, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger, Skeleton, Switch, useToast, SearchInput, confirmAction } from "@/components/ui";
import { cn } from "@/lib/utils";
import { AddConnectionDialog, ConnectorDialog } from "./ConnectorDialogs";
import { ConnectorLogo } from "./ConnectorLogo";
import { FRESH } from "@/api/queryPolicy";

/**
 * Connectors (admin): one card per system. Each card says in words how the agent reaches it (MCP
 * server, REST API or command line), where (endpoint or command), and which part of the workspace
 * uses it. Saving a catalog connector writes the MCP entry to operations.yaml with ${VAR} references
 * and puts the secret in the secret store. MCP servers can be switched on as a knowledge source.
 * Non-admins are sent to Overview, the same way Settings does it.
 */

// Data and ticket systems are not knowledge sources; the switch is offered for documentation servers such as Confluence.
const DATA_SYSTEMS = new Set(["databricks", "snowflake", "servicenow", "jira"]);

type StateFilter = "all" | "connected" | "not_connected";
const STATE_FILTER_LABEL: Record<StateFilter, string> = { all: "All", connected: "Connected", not_connected: "Not connected" };
// "Needs attention" (a configured connector whose last test failed) counts as not connected for this filter.
const matchesStateFilter = (state: ConnectorState, filter: StateFilter) => filter === "all" || (filter === "connected" ? state === "connected" : state !== "connected");

const CONNECTOR_KEYS = [connectorKeys.all, settingsKeys.all, ["connections"]] as const;

export function ConnectorsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const me = useMe();
  const admin = useIsAdmin();
  const [editing, setEditing] = useState<Connector | null>(null);
  const [adding, setAdding] = useState(false);
  const [tests, setTests] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const query = useQuery({ queryKey: connectorKeys.all, queryFn: ({ signal }) => connectorsApi.list(signal), enabled: admin });
  const settings = useQuery({ queryKey: settingsKeys.all, queryFn: ({ signal }) => settingsApi.get(signal), staleTime: FRESH.medium, enabled: admin });
  const invalidate = () => Promise.all(CONNECTOR_KEYS.map((queryKey) => refreshAfterWrite(queryClient, { queryKey })));

  const test = useMutation({
    mutationFn: (id: string) => connectorsApi.test(id),
    onSuccess: async (result) => { setTests((current) => ({ ...current, [result.id]: result.message })); if (result.status === "failed") toast.error("Connection test failed", result.message); else toast.success(result.status === "connected" ? "Connected" : `Ready for ${AGENT_NAME}`, result.message); await invalidate(); },
    onError: (error) => toast.error("Connection test failed", error instanceof Error ? error.message : "Try again."),
  });
  const remove = useMutation({
    mutationFn: (id: string) => connectorsApi.remove(id),
    onSuccess: async () => { toast.success("Connector removed", "Its secrets were deleted from the secret store."); await invalidate(); },
    onError: (error) => toast.error("Connector not removed", error instanceof Error ? error.message : "Try again."),
  });
  // operations.yaml `knowledge`: the section is written whole, so keep what is there and change only the MCP source.
  const knowledge = useAction({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => {
      const current = (settings.data?.operations.knowledge as Record<string, unknown> | undefined) ?? {};
      return settingsApi.update("knowledge", { ...current, path: current.path || "knowledge", connection: on ? id : "", mode: on ? "both" : "local" });
    },
    invalidate: [...CONNECTOR_KEYS, knowledgeKeys.all],
    success: (_result, { id, on }) => {
      const name = items.find((item) => item.id === id)?.name || id;
      return [on ? `${name} is a knowledge source` : `${name} is no longer a knowledge source`, on ? `${AGENT_NAME} searches it alongside the knowledge bases from the next task.` : "The knowledge bases stay available."];
    },
    error: "Not saved",
  });

  const items = query.data?.items ?? [];
  const term = search.trim().toLowerCase();
  const matches = useMemo(() => (item: Connector) => {
    if (!matchesStateFilter(item.state, stateFilter)) return false;
    if (!term) return true;
    return `${item.name} ${item.description || ""}`.toLowerCase().includes(term);
  }, [term, stateFilter]);
  const catalog = items.filter((item) => item.kind === "catalog" && matches(item));
  const custom = items.filter((item) => item.kind === "custom" && matches(item));
  // Catalog first, then custom, paged as one grid.
  const shown = [...catalog, ...custom];
  const pager = usePager(shown.length, { sizes: GRID_PAGE_SIZES, resetKey: JSON.stringify({ term, stateFilter }) });
  const connected = items.filter((item) => item.state === "connected").length;
  const filtered = stateFilter !== "all" || Boolean(term);
  const mcp = settings.data?.mcp?.mcpServers ?? {};
  const knowledgeSource = items.find((item) => item.knowledgeSource);

  useAgentScreen(admin ? { visible: items.map((item) => item.id), open: editing ? { kind: "connector", id: editing.id, title: editing.name } : null, summary: `${connected} of ${items.length} connected${knowledgeSource ? `; ${knowledgeSource.name} is a knowledge source` : ""}` } : null);
  if (me.isLoading) return <div role="status" aria-live="polite" className="space-y-3 p-8"><span className="sr-only">Loading</span><Skeleton className="h-4 w-40" /><Skeleton className="h-4 w-64" /></div>;
  if (me.data && !admin) return <Navigate to="/" replace />;

  const cardProps = (item: Connector) => ({
    item,
    testMessage: tests[item.id],
    testing: test.isPending && test.variables === item.id,
    onTest: () => test.mutate(item.id),
    knowledge: { enabled: admin && Boolean(settings.data) && !knowledge.isPending, onChange: (on: boolean) => knowledge.mutate({ id: item.id, on }) },
  });

  return (
    <OpsPage
      title="Connectors"
      count={query.data ? `${connected} of ${items.length} connected` : undefined}
      actions={<RefreshButton autoRefresh onClick={() => void query.refetch({ cancelRefetch: false })} busy={query.isFetching} updatedAt={query.dataUpdatedAt} />}
    >
      <QueryState query={query} tiles={0}>
        <div className="space-y-6">
          <ListToolbar>
            <SearchInput className="min-w-[220px] flex-1" label="Search connectors" value={search} onValueChange={setSearch} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className={cn("h-9 w-9 border border-line", stateFilter !== "all" && "border-ink-1 text-ink-1")} aria-label="Filter connectors" title="Filter">
                  <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>State</DropdownMenuLabel>
                {(["all", "connected", "not_connected"] as const).map((value) => (
                  <DropdownMenuItem key={value} onSelect={() => setStateFilter(value)} className="justify-between">
                    {STATE_FILTER_LABEL[value]}
                    {stateFilter === value ? <Check className="h-3.5 w-3.5 text-brand" aria-hidden="true" /> : null}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </ListToolbar>
          <section className="stagger-children grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Connectors">
            {pager.slice(shown).map((item) => item.kind === "catalog" ? (
              <ConnectorCard key={item.id} {...cardProps(item)} onConfigure={() => setEditing(item)} onRemove={() => { void confirmAction({ title: `Remove ${item.name}?`, description: `Its saved secrets are deleted and ${AGENT_NAME} loses access to it. You can connect it again later.`, confirmLabel: "Remove connector", destructive: true }).then((ok) => { if (ok) remove.mutate(item.id); }); }} />
            ) : (
              <ConnectorCard key={item.id} {...cardProps(item)} onRemove={() => { void confirmAction({ title: `Remove ${item.name}?`, description: `${AGENT_NAME} stops using it. You can add it again later.`, confirmLabel: "Remove", destructive: true }).then((ok) => { if (ok) remove.mutate(item.id); }); }} />
            ))}
            {filtered && !catalog.length && !custom.length ? <p className="col-span-full py-6 text-center text-[13.5px] text-ink-4">No connectors match</p> : null}
            <button type="button" onClick={() => setAdding(true)} className="flex min-h-[180px] flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-line-strong p-5 text-[14px] font-semibold text-ink-3 transition-colors hover:border-ink-1 hover:text-ink-1">
              <Plus className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />Add connector
              <span className="text-[12.5px] font-normal text-ink-4">MCP server, REST API or command-line tool</span>
            </button>
          </section>
          {shown.length > GRID_PAGE_SIZES[0] ? <Card className="overflow-hidden"><Pager {...pager.pagerProps} noun="connectors" /></Card> : null}
          <McpDisclosure servers={mcp} />
        </div>
      </QueryState>
      <ConnectorDialog connector={editing} onOpenChange={(open) => { if (!open) setEditing(null); }} onSaved={async (saved) => { await invalidate(); test.mutate(saved.id); }} />
      <AddConnectionDialog open={adding} onOpenChange={setAdding} onSaved={async () => { await invalidate(); }} />
    </OpsPage>
  );
}

function ConnectorCard({ item, testMessage, testing, onConfigure, onTest, onRemove, knowledge }: { item: Connector; testMessage?: string; testing: boolean; onConfigure?: () => void; onTest: () => void; onRemove: () => void; knowledge: { enabled: boolean; onChange: (on: boolean) => void } }) {
  const switchId = useId();
  const kind = item.connectionKind || "mcp";
  const target = item.kind === "custom"
    ? item.endpoint || (item.mcp ? (item.mcp.command ? `${item.mcp.command} ${item.mcp.args.join(" ")}`.trim() : item.mcp.url || "") : item.settings?.base_url || item.settings?.command || "")
    : Object.entries(item.settings || {}).map(([, value]) => value).filter(Boolean)[0] || "";
  const targetLabel = kind === "cli" ? "Command" : kind === "api" ? "Endpoint" : item.kind === "custom" ? "Server" : "Address";
  const usedFor = item.usedFor?.length ? item.usedFor.map((use) => use.label).join(" · ") : item.usedBy?.length ? item.usedBy.join(" · ") : "";
  const lastTest = testMessage || item.lastTest?.message || "";
  const showSecrets = item.configured && item.source !== "environment" && Boolean(item.secrets?.length);
  const isMcp = kind === "mcp" && item.configured && Boolean(item.mcp);
  return (
    <Card className="flex h-full flex-col p-5" data-testid={`connector-${item.id}`}>
      <div className="flex items-start justify-between gap-3">
        <ConnectorLogo id={item.id} kind={item.kind} connectionKind={kind} command={kind === "cli" ? target : undefined} />
        <div className="flex shrink-0 items-center gap-2.5 pt-0.5">
          {item.source === "environment" ? <span className="text-[11.5px] text-ink-4">From environment</span> : null}
          <StateDot state={item.state} />
        </div>
      </div>
      <h2 className="mt-3 truncate text-[15.5px] font-semibold text-ink-1">{item.name}</h2>
      <p className="mt-0.5 text-[13px] text-ink-4">{CONNECTION_KIND_LABEL[kind] || kind}{item.kind === "custom" && item.origin === "operations" ? " · from operations.yaml" : ""}</p>
      {item.description ? <p className="mt-2 line-clamp-3 text-[13.5px] leading-5 text-ink-3" title={item.description}>{item.description}</p> : null}
      <dl className="mt-3 space-y-1 text-[13.5px]">
        {target ? <Row label={targetLabel}><span className="block truncate text-[12.5px] text-ink-4" title={target}>{target}</span></Row> : null}
        {usedFor ? <Row label="Used for"><span className="text-ink-2">{usedFor}</span></Row> : null}
        {showSecrets ? <Row label="Secrets"><span className="text-ink-2">{item.secretsSet.length} of {item.secrets!.length} stored</span></Row> : null}
        {item.state === "error" && (item.reason || lastTest) ? <Row label="Problem"><span className="break-words text-rose-700">{item.reason || lastTest}</span></Row> : lastTest ? <Row label="Last test"><span className="break-words text-ink-2">{lastTest}</span></Row> : null}
      </dl>
      {isMcp && !DATA_SYSTEMS.has(item.id) ? (
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
          <label htmlFor={switchId} className="text-[13.5px] text-ink-2">Use as a knowledge source</label>
          <Switch id={switchId} checked={Boolean(item.knowledgeSource)} disabled={!knowledge.enabled} onCheckedChange={knowledge.onChange} />
        </div>
      ) : null}
      <div className="mt-auto flex items-center gap-2 pt-5">
        {item.configured ? (
          <>
            {onConfigure ? <Button size="sm" variant="outline" className="border border-line" onClick={onConfigure}>Configure</Button> : null}
            <Button size="sm" variant="outline" className="border border-line" disabled={testing} aria-busy={testing} onClick={onTest}>Test</Button>
            <OverflowMenu className="ml-auto" label={`More actions for ${item.name}`} items={[{ label: "Remove", icon: Trash2, destructive: true, onSelect: onRemove }]} />
          </>
        ) : onConfigure ? (
          <Button size="sm" variant="primary" onClick={onConfigure}>Connect</Button>
        ) : null}
      </div>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex gap-3"><dt className="w-[68px] shrink-0 text-ink-4">{label}</dt><dd className="min-w-0 flex-1">{children}</dd></div>;
}

function StateDot({ state }: { state: Connector["state"] }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-[12.5px] font-medium text-ink-3">
      <i className={cn("inline-block h-2 w-2 rounded-full", state === "connected" ? "bg-emerald-500" : state === "error" ? "bg-rose-500" : "bg-ink-5/40")} aria-hidden="true" />
      {CONNECTOR_STATE_LABEL[state] || state}
    </span>
  );
}

interface McpServerEntry { type?: string; command?: string; args?: string[]; url?: string; env?: Record<string, string> }

/** One line saying how the agent reaches this server: the command it runs, or the URL it calls. */
function mcpServerLine(server: McpServerEntry): string {
  if (server.url) return server.url;
  if (server.command) return `${server.command}${server.args?.length ? ` ${server.args.join(" ")}` : ""}`;
  return "—";
}

/**
 * Advanced, collapsed by default: what's actually in the .mcp.json the agent is started with, read
 * in plain rows instead of a raw JSON dump - the same information, in the app's own list style
 * instead of a terminal-style blob. The raw JSON is still there for the rare person who needs it
 * verbatim, tucked behind its own toggle and collapsed to a few lines by default.
 */
function McpDisclosure({ servers }: { servers: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const bodyId = useId();
  const entries = Object.entries(servers as Record<string, McpServerEntry>);
  const count = entries.length;
  return (
    <Card className="shell-card-quiet overflow-hidden">
      <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((value) => !value)} className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left transition-colors hover:bg-surface-subtle">
        <span className="flex items-center gap-1.5 text-[14px] font-medium text-ink-2">
          Advanced
          <ChevronRight className={cn("h-3.5 w-3.5 text-ink-4 transition-transform duration-150", open && "rotate-90")} aria-hidden="true" />
        </span>
        <span className="text-[13px] tabular-nums text-ink-4">{count} MCP server{count === 1 ? "" : "s"}</span>
      </button>
      {open ? (
        <div id={bodyId} className="px-5 pb-5">
          <p className="mb-3 text-[13px] text-ink-4">Servers {AGENT_NAME} starts at the beginning of every task, from operations.yaml.</p>
          {count ? (
            <ul className="mb-3 divide-y divide-line rounded-xl border border-line">
              {entries.map(([name, server]) => (
                <li key={name} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 py-2">
                  <span className="text-[13.5px] font-semibold text-ink-1">{name}</span>
                  <span className="min-w-0 truncate font-mono text-[12px] text-ink-4" title={mcpServerLine(server)}>{mcpServerLine(server)}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <button type="button" className="text-[13px] font-medium text-brand hover:text-brand-hover" onClick={() => setShowRaw((value) => !value)}>{showRaw ? "Hide raw JSON" : "View raw JSON"}</button>
          {showRaw ? <div className="mt-2"><CodeBlock language="json" code={JSON.stringify({ mcpServers: servers }, null, 2)} copyLabel="Copy .mcp.json" collapsible defaultCollapsed /></div> : null}
        </div>
      ) : null}
    </Card>
  );
}

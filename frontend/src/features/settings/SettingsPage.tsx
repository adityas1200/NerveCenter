import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { projectsApi } from "@/api/projects";
import { dataQualityApi } from "@/api/data-quality";
import { queryKeys } from "@/api/queryKeys";
import { TIMEZONES } from "@/api/routines";
import { POLICY_DEFAULTS, settingsApi, settingsKeys, type Operations, type SourceCadence, type SyncIntervalUnit, type SyncSettings, type TeamSettings, type TicketSource, type TicketingSettings } from "@/api/settings";
import { PERMISSION_LABEL, type TaskPermission } from "@/api/tasks";
import { useMe } from "@/auth/rbac";
import { useProject } from "@/lib/projectContext";
import { useAgentScreen } from "@/components/ops/agentPanelContext";
import { APP_SECTIONS } from "@/lib/appSections";
import { InfoTip } from "@/components/ops/InfoTip";
import { OpsPage } from "@/components/ops/OpsPage";
import { RefreshButton } from "@/components/ops/RefreshButton";
import { QueryState } from "@/components/ops/StatePanels";
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Skeleton, Switch } from "@/components/ui";
import { AutomationsTab } from "./AutomationsTab";
import { DataQualityTab } from "./DataQualityTab";
import { PipelinesTab } from "./PipelinesTab";
import { ModelTab } from "./ModelTab";
import { PolicyTab } from "./PolicyTab";
import { Field, GroupHeading, SaveFooter, SettingsSection, SettingsShell } from "./SettingsShell";
import { TemplatesTab } from "./TemplatesTab";
import { GrantsSection } from "./ProjectGrants";
import { ProjectPeopleTab } from "./ProjectPeopleTab";
import { isDirty, useSaveSection } from "./useSaveSection";
import { FRESH } from "@/api/queryPolicy";

/**
 * A project's Settings (SPEC-projects-03 FR-21): a form over its operations.yaml, one section per left-nav entry, plus its
 * people and what it may use. Ticketing decides which tickets become tasks; Pipelines and Data quality say what feeds those
 * pages; Automations say what happens on its own when one of them breaks; Policy sets what the agent may do without asking;
 * Model picks the Claude model and effort every run uses.
 * Owners and app admins change it. Everyone else in the project reads People and Policy, so "Why am I asked?" on an
 * approval always lands. People and the app's own settings (users, connections) live in the admin console.
 */

const SECTIONS = [
  { id: "workspace", label: "Workspace" },
  { id: "people", label: "People" },
  { id: "sources", label: "Sources" },
  { id: "ticketing", label: "Ticketing" },
  { id: "pipelines", label: "Pipelines" },
  { id: "data-quality", label: "Data quality" },
  { id: "automations", label: "Automations" },
  { id: "knowledge", label: "Knowledge and skills" },
  { id: "policy", label: "Policy" },
  { id: "model", label: "Model" },
  { id: "templates", label: "Templates" },
] as const;
type Tab = (typeof SECTIONS)[number]["id"];
const TAB_IDS: readonly Tab[] = SECTIONS.map((section) => section.id);
/** What someone who does not run the project may look at. */
const MEMBER_SECTIONS = SECTIONS.filter((section) => section.id === "people" || section.id === "policy");
/** Tabs that read the project's own routes rather than operations.yaml. */
const PROJECT_TABS: readonly Tab[] = ["people", "sources", "knowledge"];
const TICKET_PLATFORMS = [{ id: "servicenow", label: "ServiceNow" }, { id: "jira", label: "Jira" }];

function tabFrom(requested: string | null, owner: boolean): Tab {
  if (requested === "team") return "workspace"; // older links
  if (requested === "users" || requested === "projects") return "people"; // moved to the admin console; the project's own people are here
  if (TAB_IDS.includes(requested as Tab)) return requested as Tab;
  return owner ? "workspace" : "people";
}

export function SettingsPage() {
  const me = useMe();
  const { projectId, project, visitor } = useProject();
  const [searchParams, setSearchParams] = useSearchParams();
  // SPEC-projects-03 FR-6, FR-21: the project's owners and app admins run it.
  const admin = me.data?.role === "admin";
  const owner = admin || Boolean(me.data?.permissions?.includes("project.settings"));
  const tab = tabFrom(searchParams.get("tab"), owner);
  const readOnly = Boolean(me.data) && !owner;
  const projectTab = PROJECT_TABS.includes(tab);
  // Reading operations.yaml is open to every member; only writes are owner routes.
  const query = useQuery({ queryKey: settingsKeys.all, queryFn: ({ signal }) => settingsApi.get(signal), enabled: Boolean(me.data) && !projectTab && (owner || tab === "policy") });
  const dqConfig = useQuery({ queryKey: queryKeys.dataQuality.config, queryFn: ({ signal }) => dataQualityApi.config(signal), enabled: owner && tab === "data-quality" });
  useAgentScreen(me.data && !projectTab && (owner || tab === "policy") ? describeScreen(tab, query.data?.operations, dqConfig.data?.tables?.map((table) => table.name || table.resultTable)) : null);
  if (me.isLoading) return <div role="status" aria-live="polite" className="space-y-3 p-8"><span className="sr-only">Loading</span><Skeleton className="h-4 w-40" /><Skeleton className="h-4 w-64" /></div>;
  if (visitor) return <Navigate to="/" replace />;
  if (readOnly && !MEMBER_SECTIONS.some((section) => section.id === tab)) return <Navigate to="/" replace />;
  const problems = query.data?.validation.errors ?? [];
  const select = (value: Tab) => { const next = new URLSearchParams(searchParams); if (value === (owner ? "workspace" : "people")) next.delete("tab"); else next.set("tab", value); setSearchParams(next, { replace: true }); };
  const items = readOnly ? MEMBER_SECTIONS : SECTIONS;
  const subtitle = project?.name;

  // People, Sources and Knowledge read the project's own routes, not operations.yaml.
  if (projectTab) {
    return (
      <OpsPage title="Settings" count={subtitle}>
        <SettingsShell items={items} active={tab} onSelect={select}>
          <div key={tab} className="page-enter">
            {tab === "people" && projectId ? <ProjectPeopleTab projectId={projectId} canManage={owner} /> : null}
            {tab === "sources" && projectId ? <GrantsSection projectId={projectId} globalAdmin={admin} types={["connection"]} title="Sources" /> : null}
            {tab === "knowledge" && projectId ? <GrantsSection projectId={projectId} globalAdmin={admin} types={["knowledge", "skill"]} title="Knowledge and skills" /> : null}
          </div>
        </SettingsShell>
      </OpsPage>
    );
  }

  return (
    <OpsPage title="Settings" count={readOnly ? "Read only" : subtitle} actions={<RefreshButton autoRefresh={tab !== "automations"} onClick={() => void query.refetch({ cancelRefetch: false })} busy={query.isFetching} updatedAt={query.dataUpdatedAt} />}>
      <QueryState query={query} tiles={0}>
        {problems.length && !readOnly ? <div role="alert" className="mb-4 break-words rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13.5px] text-amber-900"><span className="font-semibold">operations.yaml</span> {problems.join(" · ")}</div> : null}
        <SettingsShell items={items} active={tab} onSelect={select}>
          {query.data ? (
            <div key={tab} className="page-enter">
              {tab === "workspace" ? <WorkspaceTab operations={query.data.operations} onOpen={select} /> : null}
              {tab === "ticketing" ? <TicketingTab operations={query.data.operations} /> : null}
              {tab === "pipelines" ? <PipelinesTab operations={query.data.operations} /> : null}
              {tab === "data-quality" ? <DataQualityTab /> : null}
              {tab === "automations" ? <AutomationsTab /> : null}
              {tab === "policy" ? <PolicyTab operations={query.data.operations} readOnly={readOnly} /> : null}
              {tab === "model" ? <ModelTab operations={query.data.operations} /> : null}
              {tab === "templates" ? <TemplatesTab operations={query.data.operations} /> : null}
            </div>
          ) : null}
        </SettingsShell>
      </QueryState>
    </OpsPage>
  );
}

/** One line for the agent about the open section, plus the names listed in it. */
function describeScreen(tab: Tab, operations: Operations | undefined, dqTables: string[] | undefined) {
  const label = SECTIONS.find((section) => section.id === tab)?.label ?? tab;
  if (tab === "policy") {
    const policy = { ...POLICY_DEFAULTS, ...operations?.policy };
    return { summary: `Settings, Policy: ${Object.entries(policy).filter(([, value]) => typeof value === "string").map(([key, value]) => `${key}=${value}`).join(", ")}` };
  }
  if (tab === "model") return { summary: `Settings, Model: ${operations?.agent?.model || "sonnet"} at ${operations?.agent?.effort || "high"} effort` };
  if (tab === "pipelines") return { summary: "Settings, Pipelines: platforms whose jobs the Pipelines page lists", visible: (operations?.platforms || []).map((platform) => platform.name) };
  if (tab === "data-quality") return { summary: "Settings, Data quality: result tables the Data Quality page reads", visible: dqTables || [] };
  if (tab === "automations") { const automation = operations?.automation as Record<string, { action?: string } | undefined> | undefined; return { summary: automation ? `Settings, Automations: pipeline failed ${automation.pipelineFailed?.action || "off"}, pipeline late ${automation.pipelineLate?.action || "off"}, check failed ${automation.dqFailed?.action || "off"}` : "Settings, Automations: not set up; a NerveCenter ticket opens for each failed Databricks run" }; }
  if (tab === "ticketing") return { summary: "Settings, Ticketing: ticket sources that become tasks", visible: (operations?.ticketing?.app?.sources || []).map((source) => `${source.platform}:${source.connection || ""}`) };
  return { summary: `Settings, ${label}` };
}

/** Workspace: the name and timezone. People and roles live in Users & roles; the agent's name comes from the deployment. */
function WorkspaceTab({ operations, onOpen }: { operations: Operations; onOpen: (tab: Tab) => void }) {
  const save = useSaveSection();
  const syncSave = useSaveSection({ successMessage: "Auto sync setting saved" });
  const sectionsSave = useSaveSection({ successMessage: "Sections saved" });
  const [team, setTeam] = useState(() => workspaceDraft(operations.team));
  const [sync, setSync] = useState(() => syncDraft(operations.sync));
  const [disabledSections, setDisabledSections] = useState(() => operations.ui?.disabledSections ?? []);
  useEffect(() => { setTeam(workspaceDraft(operations.team)); }, [operations.team]);
  useEffect(() => { setSync(syncDraft(operations.sync)); }, [operations.sync]);
  useEffect(() => { setDisabledSections(operations.ui?.disabledSections ?? []); }, [operations.ui]);
  const syncIntervalValid = Number.isFinite(sync.intervalValue) && sync.intervalValue > 0;
  const cadenceProblem = cadenceProblemOf(sync);
  const complete = Boolean(team.name.trim() && team.timezone.trim());
  // The rest of `team` (for example an older `operator` block) is passed through untouched.
  const onSave = () => save.mutate({ section: "team", value: { ...(operations.team || {}), name: team.name.trim(), timezone: team.timezone } });
  const policy = { ...POLICY_DEFAULTS, ...operations.policy };
  const asks = Object.values(policy).filter((value) => value === "ask").length;
  const { projectId } = useProject();
  const members = useQuery({ queryKey: queryKeys.projectMembers(projectId), queryFn: ({ signal }) => projectsApi.members(projectId as string, signal), enabled: Boolean(projectId) && projectId !== "*", staleTime: FRESH.long });
  const peopleCount = members.data?.items.length;
  const glance: Array<{ tab: Tab; label: string; value: string }> = [
    { tab: "ticketing", label: "Ticketing", value: `${operations.ticketing?.app?.sources?.length ?? 0} ticket ${(operations.ticketing?.app?.sources?.length ?? 0) === 1 ? "source" : "sources"}` },
    { tab: "pipelines", label: "Pipelines", value: `${operations.platforms?.length ?? 0} ${(operations.platforms?.length ?? 0) === 1 ? "platform" : "platforms"}` },
    { tab: "automations", label: "Automations", value: automationGlance(operations) },
    { tab: "policy", label: "Policy", value: `${asks} of ${Object.keys(POLICY_DEFAULTS).length} categories ask before a change` },
    { tab: "people", label: "People", value: peopleCount === undefined ? "…" : `${peopleCount} ${peopleCount === 1 ? "person" : "people"}` },
  ];
  return (
    <div className="space-y-4">
      <SettingsSection title="Workspace" footer={<SaveFooter pending={save.isPending} dirty={isDirty(team, workspaceDraft(operations.team))} disabled={!complete || !isDirty(team, workspaceDraft(operations.team))} onSave={onSave} />}>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Workspace name" htmlFor="team-name" help="Shown in reports and summaries"><Input id="team-name" value={team.name} onChange={(event) => setTeam((current) => ({ ...current, name: event.target.value }))} placeholder="Data Operations" /></Field>
          <Field label="Timezone" htmlFor="team-timezone" help="Used for routine schedules and dates">
            <Select value={team.timezone} onValueChange={(value) => setTeam((current) => ({ ...current, timezone: value }))}><SelectTrigger id="team-timezone" aria-label="Timezone"><SelectValue /></SelectTrigger><SelectContent>{[...new Set([team.timezone, ...TIMEZONES])].map((zone) => <SelectItem key={zone} value={zone}>{zone}</SelectItem>)}</SelectContent></Select>
          </Field>
        </div>
      </SettingsSection>
      <SettingsSection
        title="Automatic sync"
        footer={<SaveFooter pending={syncSave.isPending} dirty={isDirty(sync, syncDraft(operations.sync))} disabled={(sync.enabled && !syncIntervalValid) || Boolean(cadenceProblem) || !isDirty(sync, syncDraft(operations.sync))} onSave={() => syncSave.mutate({ section: "sync", value: syncValue(operations.sync, sync) })} />}
      >
        <div className="grid items-start gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(260px,auto)]">
          <Field label="Auto sync" htmlFor="auto-sync" help="Keeps Jira, Databricks, GitHub and Git knowledge current while somebody is using NerveCenter.">
            <div className="flex h-9 items-center gap-3"><Switch id="auto-sync" aria-label="Auto sync" checked={sync.enabled} onCheckedChange={(enabled) => setSync((current) => ({ ...current, enabled }))} /><span className="text-[13.5px] font-medium text-ink-3">{sync.enabled ? "On" : "Off"}</span></div>
          </Field>
          <Field label="Sync every" htmlFor="sync-interval-value" help={sync.enabled ? (syncIntervalValid ? "Applies to every connected source" : "Enter a number greater than 0") : "Available when auto sync is on"}>
            <div className="flex items-center gap-2">
              <Input id="sync-interval-value" type="number" inputMode="numeric" min={1} step={1} className="w-24" value={sync.intervalValue} disabled={!sync.enabled} onChange={(event) => { const next = Math.trunc(Number(event.target.value)); setSync((current) => ({ ...current, intervalValue: Number.isFinite(next) ? next : current.intervalValue })); }} aria-invalid={sync.enabled && !syncIntervalValid} />
              <Select value={sync.intervalUnit} onValueChange={(value) => setSync((current) => ({ ...current, intervalUnit: value as SyncIntervalUnit }))} disabled={!sync.enabled}>
                <SelectTrigger className="w-[130px]" aria-label="Sync interval unit"><SelectValue /></SelectTrigger>
                <SelectContent>{SYNC_INTERVAL_UNITS.map((unit) => <SelectItem key={unit.value} value={unit.value}>{unit.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </Field>
        </div>
        <div className="my-5 border-t border-line" />
        <GroupHeading>Fetch from each source</GroupHeading>
        <div className="mt-3 grid gap-5 sm:grid-cols-2">
          <CadenceField id="cadence-pipelines" label="Pipelines" help="Runs and schedules from Databricks and Snowflake" value={sync.pipelines} disabled={!sync.enabled} onChange={(pipelines) => setSync((current) => ({ ...current, pipelines }))} />
          <CadenceField id="cadence-dq" label="Data quality" help="Results from the DQ result tables" value={sync.dataQuality} disabled={!sync.enabled} onChange={(dataQuality) => setSync((current) => ({ ...current, dataQuality }))} />
          <CadenceField id="cadence-tickets" label="Tickets" help={sync.tickets.every ? "New and changed tickets from ServiceNow and Jira" : "Empty: every sync interval above"} value={sync.tickets} optional disabled={!sync.enabled} onChange={(tickets) => setSync((current) => ({ ...current, tickets }))} />
          <Field label="Keep history" htmlFor="retain-days" help="Days of runs and check results kept for the pages and Sonic">
            <div className="flex items-center gap-2"><Input id="retain-days" type="number" min={1} max={365} step={1} className="w-24" value={Number.isFinite(sync.retainDays) ? sync.retainDays : ""} onChange={(event) => setSync((current) => ({ ...current, retainDays: event.target.value === "" ? Number.NaN : Math.trunc(Number(event.target.value)) }))} /><span className="text-[13.5px] text-ink-3">days</span></div>
          </Field>
        </div>
        {cadenceProblem ? <p role="alert" className="mt-3 text-[13px] text-rose-700">{cadenceProblem}</p> : null}
        <p className="mt-4 text-[12.5px] leading-5 text-ink-4">Polling pauses when nobody is using the app, unless an automation is on. Manual sync remains available when auto sync is off.</p>
      </SettingsSection>
      <SettingsSection
        title="Pages"
        footer={<SaveFooter pending={sectionsSave.isPending} disabled={!isDirty(disabledSections, operations.ui?.disabledSections ?? [])} onSave={() => sectionsSave.mutate({ section: "ui", value: { ...(operations.ui || {}), disabledSections } })} />}
      >
        <p className="mb-3 text-[13px] text-ink-4">Hide a page this workspace doesn&apos;t need. It&apos;s removed from the sidebar and its direct link stops opening, for everyone.</p>
        <ul className="divide-y divide-line">
          {APP_SECTIONS.map((section) => {
            const enabled = !disabledSections.includes(section.id);
            return (
              <li key={section.id} className="flex items-center justify-between gap-3 py-2.5">
                <label htmlFor={`section-${section.id}`} className="text-[14px] text-ink-2">{section.label}</label>
                <Switch
                  id={`section-${section.id}`}
                  aria-label={section.label}
                  checked={enabled}
                  onCheckedChange={(checked) => setDisabledSections((current) => checked ? current.filter((id) => id !== section.id) : [...current, section.id])}
                />
              </li>
            );
          })}
        </ul>
      </SettingsSection>
      <SettingsSection title="Setup at a glance">
        <ul className="-mx-2 -mb-2 divide-y divide-line">
          {glance.map((row) => (
            <li key={row.tab}>
              <button type="button" onClick={() => onOpen(row.tab)} className="flex w-full items-center justify-between gap-4 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-surface-subtle">
                <span className="text-[14px] font-medium text-ink-1">{row.label}</span>
                <span className="flex items-center gap-2 text-[13.5px] text-ink-4">{row.value}<ChevronRight className="h-3.5 w-3.5 text-ink-5" aria-hidden="true" /></span>
              </button>
            </li>
          ))}
        </ul>
      </SettingsSection>
    </div>
  );
}

/** How many triggers do something on their own, or the earlier rule when the project never saved one. */
function automationGlance(operations: Operations): string {
  const automation = operations.automation as ({ enabled?: boolean } & Record<string, unknown>) | undefined;
  if (!automation) return "A ticket per failed Databricks run";
  if (automation.enabled === false) return "Off";
  const on = ["pipelineFailed", "pipelineLate", "dqFailed"].filter((key) => { const action = (automation[key] as { action?: string } | undefined)?.action; return action && action !== "off"; }).length;
  return `${on} of 3 triggers on`;
}

function workspaceDraft(team?: TeamSettings): { name: string; timezone: string } {
  return { name: team?.name || "", timezone: team?.timezone || "Asia/Kolkata" };
}

const SYNC_INTERVAL_UNITS: ReadonlyArray<{ value: SyncIntervalUnit; label: string }> = [
  { value: "seconds", label: "Seconds" },
  { value: "minutes", label: "Minutes" },
  { value: "hours", label: "Hours" },
];
const UNIT_SECONDS: Record<SyncIntervalUnit, number> = { seconds: 1, minutes: 60, hours: 3600 };
/** A cadence with `every` 0 means "not set": tickets then follow the sync interval. */
const cadence = (value: SourceCadence | undefined, fallback: SourceCadence): SourceCadence => value && value.every > 0 && UNIT_SECONDS[value.unit] ? { every: value.every, unit: value.unit } : fallback;
interface SyncDraft { enabled: boolean; intervalValue: number; intervalUnit: SyncIntervalUnit; pipelines: SourceCadence; dataQuality: SourceCadence; tickets: SourceCadence; retainDays: number }
/** Preserve older interval_seconds workspaces; new workspaces default to 15 seconds. Pipelines every 5 and data quality every 15 minutes unless set (SPEC-platform-10). */
function syncDraft(sync?: SyncSettings): SyncDraft {
  return {
    enabled: sync?.enabled !== false, intervalValue: sync?.intervalValue && sync.intervalValue > 0 ? sync.intervalValue : sync?.interval_seconds && sync.interval_seconds > 0 ? sync.interval_seconds : 15, intervalUnit: sync?.intervalUnit || "seconds",
    pipelines: cadence(sync?.pipelines, { every: 5, unit: "minutes" }), dataQuality: cadence(sync?.dataQuality, { every: 15, unit: "minutes" }), tickets: cadence(sync?.tickets, { every: 0, unit: "minutes" }), retainDays: Number.isInteger(sync?.retainDays) ? Number(sync?.retainDays) : 60,
  };
}
function cadenceProblemOf(sync: SyncDraft): string | null {
  for (const [label, value, optional] of [["Pipelines", sync.pipelines, false], ["Data quality", sync.dataQuality, false], ["Tickets", sync.tickets, true]] as const) {
    if (optional && !value.every) continue;
    const seconds = value.every * UNIT_SECONDS[value.unit];
    if (!(seconds >= 30 && seconds <= 86_400)) return `${label} must be fetched between every 30 seconds and every 24 hours`;
  }
  if (!(Number.isInteger(sync.retainDays) && sync.retainDays >= 1 && sync.retainDays <= 365)) return "Keep history from 1 to 365 days";
  return null;
}
/** The sync section to save: the rest of it (knowledge cadence and anything the plugin keeps there) passes through. */
function syncValue(previous: SyncSettings | undefined, sync: SyncDraft): SyncSettings {
  const value: SyncSettings = { ...(previous || {}), enabled: sync.enabled, intervalValue: sync.intervalValue, intervalUnit: sync.intervalUnit, pipelines: sync.pipelines, dataQuality: sync.dataQuality, retainDays: sync.retainDays };
  if (sync.tickets.every > 0) value.tickets = sync.tickets; else delete value.tickets;
  delete value.interval_seconds;
  return value;
}

/** "Every [5] [minutes]"; an optional one may be left empty. */
function CadenceField({ id, label, help, value, onChange, optional = false, disabled = false }: { id: string; label: string; help: string; value: SourceCadence; onChange: (value: SourceCadence) => void; optional?: boolean; disabled?: boolean }) {
  return (
    <Field label={label} htmlFor={id} help={help}>
      <div className="flex items-center gap-2">
        <span className="text-[13.5px] text-ink-3">Every</span>
        <Input id={id} type="number" inputMode="numeric" min={optional ? 0 : 1} step={1} className="w-20" value={value.every || ""} placeholder={optional ? "—" : undefined} disabled={disabled} onChange={(event) => { const every = Math.trunc(Number(event.target.value)); onChange({ ...value, every: Number.isFinite(every) && every > 0 ? every : 0 }); }} />
        <Select value={value.unit} onValueChange={(unit) => onChange({ ...value, unit: unit as SyncIntervalUnit })} disabled={disabled}>
          <SelectTrigger className="w-[120px]" aria-label={`${label} fetch unit`}><SelectValue /></SelectTrigger>
          <SelectContent>{SYNC_INTERVAL_UNITS.map((unit) => <SelectItem key={unit.value} value={unit.value}>{unit.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
    </Field>
  );
}

function blankSource(platform: string, connections: string[]): TicketSource {
  return { platform, connection: connections.includes(platform) ? platform : connections.includes("atlassian") && platform === "jira" ? "atlassian" : connections[0] || null, filters: {}, auto_create_tasks: false, max_concurrent_tasks: 3, permission: "read-only" };
}

function ticketingDraft(operations: Operations) {
  return {
    sources: operations.ticketing?.app?.sources || [],
    category: String(operations.ticketing?.fields?.category || ""),
    project: String(operations.ticketing?.scope?.project || ""),
    queue: String(operations.ticketing?.scope?.queue || ""),
  };
}

function TicketingTab({ operations }: { operations: Operations }) {
  const save = useSaveSection();
  const connections = Object.keys(operations.connections || {});
  const ticketing: TicketingSettings = operations.ticketing || {};
  const [sources, setSources] = useState<TicketSource[]>(() => ticketingDraft(operations).sources);
  const [category, setCategory] = useState(() => ticketingDraft(operations).category);
  const [project, setProject] = useState(() => ticketingDraft(operations).project);
  const [queue, setQueue] = useState(() => ticketingDraft(operations).queue);
  useEffect(() => { const draft = ticketingDraft(operations); setSources(draft.sources); setCategory(draft.category); setProject(draft.project); setQueue(draft.queue); }, [operations]);
  const dirty = isDirty({ sources, category, project, queue }, ticketingDraft(operations));
  const update = (index: number, patch: Partial<TicketSource>) => setSources((current) => current.map((source, i) => i === index ? { ...source, ...patch } : source));
  const scopeOf = (source: TicketSource) => source.platform === "jira" ? String(source.filters?.jql || "") : String(source.filters?.assignmentGroup || "");
  const setScope = (index: number, value: string) => { const source = sources[index]; update(index, { filters: source.platform === "jira" ? { ...source.filters, jql: value.trim() || undefined } : { ...source.filters, assignmentGroup: value.trim() || undefined } }); };
  const onSave = () => {
    const first = sources[0];
    const value: TicketingSettings = { ...ticketing, platform: first?.platform || ticketing.platform || "", connection: first?.connection || ticketing.connection || "", scope: { ...(ticketing.scope || {}), project: project.trim(), queue: queue.trim() }, fields: { ...(ticketing.fields || {}), category: category.trim() }, app: { ...(ticketing.app || {}), sources: sources.map((source) => ({ ...source, connection: source.connection || "", max_concurrent_tasks: Math.max(1, Number(source.max_concurrent_tasks) || 3) })) } };
    save.mutate({ section: "ticketing", value });
  };
  const addSource = <Button size="sm" variant="outline" className="border border-line" onClick={() => setSources((current) => [...current, blankSource(current.some((source) => source.platform === "servicenow") ? "jira" : "servicenow", connections)])}><Plus className="h-4 w-4" />Add source</Button>;
  return (
    <SettingsSection title="Ticketing" footer={<SaveFooter pending={save.isPending} disabled={!dirty} onSave={onSave} />}>
      <GroupHeading action={addSource}>Ticket sources</GroupHeading>
      {sources.length ? (
        <div className="mt-3 space-y-3">
          {sources.map((source, index) => {
            const n = index + 1;
            return (
              <div key={index} className="min-w-0 rounded-xl border border-line p-4">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-ink-3">Source {n}</span>
                  <Button size="icon" variant="ghost" aria-label={`Remove source ${n}`} onClick={() => setSources((current) => current.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></Button>
                </div>
                <div className="mt-2 grid gap-4 sm:grid-cols-2">
                  <Field label="Platform" htmlFor={`source-platform-${n}`}>
                    <Select value={source.platform} onValueChange={(value) => update(index, { platform: value, connection: connections.includes(value) ? value : value === "jira" && connections.includes("atlassian") ? "atlassian" : source.connection, filters: {} })}><SelectTrigger id={`source-platform-${n}`} aria-label={`Source ${n} platform`}><SelectValue /></SelectTrigger><SelectContent>{TICKET_PLATFORMS.map((item) => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}</SelectContent></Select>
                  </Field>
                  <Field label="Connection" htmlFor={`source-connection-${n}`}>
                    {connections.length ? <Select value={source.connection || ""} onValueChange={(value) => update(index, { connection: value })}><SelectTrigger id={`source-connection-${n}`} aria-label={`Source ${n} connection`}><SelectValue placeholder="Pick a connector" /></SelectTrigger><SelectContent>{connections.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent></Select> : <Link id={`source-connection-${n}`} to="/connectors" className="inline-flex h-9 items-center text-[14px] text-brand hover:underline">Add a connection on Connectors</Link>}
                  </Field>
                  <Field label="Scope" htmlFor={`source-scope-${n}`} className="sm:col-span-2" help={source.platform === "jira" ? "JQL filter. Empty means every open issue in the project key below" : "ServiceNow assignment group. Empty means every open incident"}>
                    <Input id={`source-scope-${n}`} aria-label={`Source ${n} scope`} className="font-mono text-[13px]" value={scopeOf(source)} onChange={(event) => setScope(index, event.target.value)} placeholder={source.platform === "jira" ? "project = DATAOPS AND priority in (Highest, High)" : "Assignment group"} />
                  </Field>
                  <Field label="Auto-create tasks" htmlFor={`source-auto-${n}`} help="A task starts for each new ticket">
                    <div className="flex h-9 items-center"><Switch id={`source-auto-${n}`} aria-label={`Source ${n} auto-create tasks`} checked={source.auto_create_tasks === true} onCheckedChange={(checked) => update(index, { auto_create_tasks: checked })} /></div>
                  </Field>
                  <Field label="Tasks at once" htmlFor={`source-max-${n}`} help="Upper limit on parallel tasks from this source">
                    <Input id={`source-max-${n}`} aria-label={`Source ${n} max concurrent tasks`} type="number" min={1} max={20} className="w-[96px]" value={source.max_concurrent_tasks ?? 3} onChange={(event) => update(index, { max_concurrent_tasks: Number(event.target.value) })} />
                  </Field>
                  <Field label="Permission" htmlFor={`source-permission-${n}`} help="How far a task goes before it asks" tip={<InfoTip>Read-only tasks investigate and report. Higher levels let a task make changes, still within Policy.</InfoTip>}>
                    <Select value={source.permission || "read-only"} onValueChange={(value) => update(index, { permission: value as TaskPermission })}><SelectTrigger id={`source-permission-${n}`} aria-label={`Source ${n} permission`}><SelectValue /></SelectTrigger><SelectContent>{(Object.keys(PERMISSION_LABEL) as TaskPermission[]).map((value) => <SelectItem key={value} value={value}>{PERMISSION_LABEL[value]}</SelectItem>)}</SelectContent></Select>
                  </Field>
                </div>
              </div>
            );
          })}
        </div>
      ) : <p className="mt-3 text-[13.5px] text-ink-4">No ticket sources</p>}
      <div className="my-5 border-t border-line" />
      <GroupHeading>Ticket fields</GroupHeading>
      <div className="mt-3 grid gap-5 sm:grid-cols-2">
        <Field label="Category field" htmlFor="ticketing-category" help="Ticket field that holds the work type, such as labels or u_category"><Input id="ticketing-category" value={category} onChange={(event) => setCategory(event.target.value)} placeholder="labels" /></Field>
        <Field label="Project key" htmlFor="ticketing-project" help="Jira project used when a scope names none"><Input id="ticketing-project" value={project} onChange={(event) => setProject(event.target.value)} placeholder="DATAOPS" /></Field>
        <Field label="Queue" htmlFor="ticketing-queue" help="Assignment group or queue Sonic works from"><Input id="ticketing-queue" value={queue} onChange={(event) => setQueue(event.target.value)} placeholder="Data Operations" /></Field>
      </div>
    </SettingsSection>
  );
}

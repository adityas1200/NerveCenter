import { RefreshButton } from "@/components/ops/RefreshButton";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ACTION_LABEL, TRIGGER_LABEL, automationApi, automationKeys, type AutomationAction, type AutomationConfig, type AutomationLimits, type AutomationOverride, type AutomationPermission, type AutomationTicket, type DqFailedSettings, type DqSeverity, type MonitoringStatus, type PipelineFailedSettings, type PipelineLateSettings, type RecoveryAction, type SourceStatus, type TicketPlatformChoice, type TicketPriorityChoice } from "@/api/automation";
import { dataQualityApi } from "@/api/data-quality";
import { platformApi } from "@/api/platform";
import { queryKeys } from "@/api/queryKeys";
import { settingsApi, settingsKeys } from "@/api/settings";
import { PERMISSION_LABEL } from "@/api/tasks";
import { AGENT_NAME } from "@/components/ops/agentPanelContext";
import { InfoTip } from "@/components/ops/InfoTip";
import { QueryState } from "@/components/ops/StatePanels";
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch, formatRelativeTime } from "@/components/ui";
import { useAction } from "@/lib/useAction";
import { Field, GroupHeading, SettingsSection } from "./SettingsShell";
import { isDirty } from "./useSaveSection";
import { FRESH } from "@/api/queryPolicy";

/**
 * Automations (SPEC-automations-01): what happens on its own when a pipeline fails, runs late or misses a run, or a data
 * quality check fails. Per trigger: nothing, a ticket, an investigation by Sonic, or both; how far Sonic may go; the knowledge
 * page that says how this client handles it. Then where tickets go, the limits that keep it calm, and exceptions for single
 * pipelines or result tables. Owners change it; the save is stamped with who and when.
 */

type Draft = Pick<AutomationConfig, "enabled" | "limits" | "ticket" | "overrides"> & { pipelineFailed: Omit<PipelineFailedSettings, "platforms">; pipelineLate: PipelineLateSettings; dqFailed: DqFailedSettings };

const ACTIONS: AutomationAction[] = ["off", "task", "ticket", "task_and_ticket"];
const ACTION_HELP: Record<AutomationAction, string> = { off: "Nothing happens on its own", task: `${AGENT_NAME} investigates and reports in a task`, ticket: "A ticket is opened; nobody investigates", task_and_ticket: `A ticket is opened and ${AGENT_NAME} investigates it, keeping the ticket updated` };
const PERMISSIONS: AutomationPermission[] = ["read-only", "policy"];
const SEVERITIES: DqSeverity[] = ["critical", "high", "medium", "low", "info"];
const TICKET_PLATFORMS: Array<[TicketPlatformChoice, string]> = [["auto", "The project's ticketing source"], ["nervecenter", "NerveCenter"], ["servicenow", "ServiceNow"], ["jira", "Jira"]];
const PRIORITIES: Array<[TicketPriorityChoice, string]> = [["auto", "By what happened"], ["critical", "Critical"], ["high", "High"], ["medium", "Medium"], ["low", "Low"]];
const RECOVERY: Array<[RecoveryAction, string]> = [["comment", "Add a note"], ["resolve", "Note and resolve"], ["none", "Leave it"]];
const PLAYBOOK_HINT = { pipelineFailed: "playbooks/pipeline-failed.md", pipelineLate: "playbooks/pipeline-late.md", dqFailed: "playbooks/dq-failed.md" } as const;
const LIMIT_FIELDS: Array<{ key: keyof AutomationLimits; label: string; help: string; min: number; max: number }> = [
  { key: "maxConcurrent", label: "Investigations at once", help: "More wait their turn, for up to six hours", min: 1, max: 20 },
  { key: "maxPerDay", label: "Investigations per day", help: "Past this, alerts are recorded but not investigated", min: 1, max: 1000 },
  { key: "cooldownMinutes", label: "Quiet period, minutes", help: "No second investigation of the same asset within this time", min: 0, max: 1440 },
  { key: "reopenHours", label: "Reopen within, hours", help: "A problem back within this time reopens the same alert", min: 0, max: 168 },
];
const BOUNDS = { graceMinutes: [1, 240], lookbackHours: [1, 168], longRunningFactor: [1.2, 20] } as const;

function draftOf(config: AutomationConfig): Draft {
  const { platforms: _platforms, ...pipelineFailed } = config.pipelineFailed;
  // A project on the older rule starts from it: a ticket per failed run, as it does today.
  return { enabled: config.enabled, limits: { ...config.limits }, ticket: { ...config.ticket }, overrides: { pipelines: { ...config.overrides.pipelines }, tables: { ...config.overrides.tables } }, pipelineFailed, pipelineLate: { ...config.pipelineLate }, dqFailed: { ...config.dqFailed, tables: [...config.dqFailed.tables] } };
}
const inRange = (value: number, [min, max]: readonly [number, number], whole = true) => Number.isFinite(value) && value >= min && value <= max && (!whole || Number.isInteger(value));
function problemsOf(draft: Draft): string[] {
  const problems: string[] = [];
  if (!inRange(draft.pipelineLate.graceMinutes, BOUNDS.graceMinutes)) problems.push("Grace must be 1 to 240 minutes");
  if (!inRange(draft.pipelineLate.lookbackHours, BOUNDS.lookbackHours)) problems.push("Look back must be 1 to 168 hours");
  if (!inRange(draft.pipelineLate.longRunningFactor, BOUNDS.longRunningFactor, false)) problems.push("Longer than usual must be 1.2 to 20 times");
  for (const field of LIMIT_FIELDS) if (!inRange(draft.limits[field.key], [field.min, field.max])) problems.push(`${field.label} must be ${field.min} to ${field.max}`);
  return problems;
}

export function AutomationsTab() {
  const query = useQuery({ queryKey: automationKeys.config, queryFn: ({ signal }) => automationApi.get(signal), refetchInterval: false });
  return (
    <><div className="mb-3 flex justify-end"><RefreshButton autoRefresh onClick={() => void query.refetch({ cancelRefetch: false })} busy={query.isFetching} updatedAt={query.dataUpdatedAt} /></div><QueryState query={query} tiles={0}>
      {query.data?.config ? <AutomationsForm config={query.data.config} status={query.data.status} /> : null}
    </QueryState></>
  );
}

function AutomationsForm({ config, status }: { config: AutomationConfig; status: MonitoringStatus | null }) {
  const [draft, setDraft] = useState(() => draftOf(config));
  useEffect(() => { setDraft(draftOf(config)); }, [config]);
  const pipelines = useQuery({ queryKey: [...queryKeys.pipelines.lists(), "automation"], queryFn: ({ signal }) => platformApi.pipelines(1000, signal), staleTime: FRESH.long, retry: false });
  const dqTables = useQuery({ queryKey: queryKeys.dataQuality.config, queryFn: ({ signal }) => dataQualityApi.config(signal), staleTime: FRESH.long });
  const tables = (dqTables.data?.tables ?? []).filter((table) => table.id);
  const save = useAction({
    mutationFn: (value: Draft) => settingsApi.update("automation", value),
    invalidate: [settingsKeys.all, automationKeys.all, queryKeys.monitor.all],
    success: "Automations saved",
    error: "Automations not saved",
  });
  const problems = problemsOf(draft);
  const dirty = config.legacy || isDirty(draft, draftOf(config));
  const set = <K extends keyof Draft>(key: K, patch: Partial<Draft[K]>) => setDraft((current) => ({ ...current, [key]: { ...(current[key] as object), ...patch } }));
  const footer = (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
      <p className="text-[12.5px] text-ink-4">{problems[0] ? <span className="text-rose-700">{problems[0]}</span> : config.updatedBy ? `Changed by ${config.updatedBy.name || config.updatedBy.id}${config.updatedAt ? ` ${formatRelativeTime(config.updatedAt)}` : ""}` : config.legacy ? "Not saved yet" : null}</p>
      <SaveFooterButton pending={save.isPending} disabled={!dirty || problems.length > 0} onSave={() => save.mutate(draft)} />
    </div>
  );
  // One Save for the whole automation, repeated under each card so it is never a scroll away.
  const saveOnly = <div className="flex justify-end border-t border-line px-5 py-3"><SaveFooterButton pending={save.isPending} disabled={!dirty || problems.length > 0} onSave={() => save.mutate(draft)} /></div>;
  const usesTicket = [draft.pipelineFailed.action, draft.pipelineLate.action, draft.dqFailed.action].some((action) => action === "ticket" || action === "task_and_ticket");

  return (
    <div className="space-y-4" data-auto-refresh-block={dirty}>
      <SettingsSection title="Automations" action={<label className="flex items-center gap-2 text-[13.5px] font-medium text-ink-3"><Switch aria-label="Automations on" checked={draft.enabled} onCheckedChange={(enabled) => setDraft((current) => ({ ...current, enabled }))} />{draft.enabled ? "On" : "Off"}</label>} footer={footer}>
        {config.legacy ? <p className="mb-4 rounded-xl border border-line bg-surface-subtle px-4 py-3 text-[13.5px] text-ink-3">This project uses the earlier rule: a NerveCenter ticket for each failed Databricks run, and no investigation. Saving here replaces it with what is set below.</p> : null}
        {status ? <FetchStatus status={status} /> : null}
        <div className="mt-4 space-y-5">
          <TriggerBlock trigger="pipelineFailed" value={draft.pipelineFailed} onChange={(patch) => set("pipelineFailed", patch)} />
          <div className="border-t border-line" />
          <TriggerBlock trigger="pipelineLate" value={draft.pipelineLate} onChange={(patch) => set("pipelineLate", patch)}>
            <div className="grid gap-4 sm:grid-cols-3">
              <NumberField id="late-grace" label="Grace, minutes" help="After a scheduled start" value={draft.pipelineLate.graceMinutes} onChange={(graceMinutes) => set("pipelineLate", { graceMinutes })} />
              <NumberField id="late-lookback" label="Look back, hours" help="Slots judged on each pass" value={draft.pipelineLate.lookbackHours} onChange={(lookbackHours) => set("pipelineLate", { lookbackHours })} />
              <NumberField id="late-factor" label="Longer than usual, times" help="For a run still going" step={0.1} value={draft.pipelineLate.longRunningFactor} onChange={(longRunningFactor) => set("pipelineLate", { longRunningFactor })} disabled={!draft.pipelineLate.longRunning} />
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <Toggle id="late-not-started" label="Not started after the grace" checked={draft.pipelineLate.notStarted} onChange={(notStarted) => set("pipelineLate", { notStarted })} />
              <Toggle id="late-missed" label="A scheduled run missed" checked={draft.pipelineLate.missedSlots} onChange={(missedSlots) => set("pipelineLate", { missedSlots })} />
              <Toggle id="late-long" label="Running much longer than usual" checked={draft.pipelineLate.longRunning} onChange={(longRunning) => set("pipelineLate", { longRunning })} />
            </div>
          </TriggerBlock>
          <div className="border-t border-line" />
          <TriggerBlock trigger="dqFailed" value={draft.dqFailed} onChange={(patch) => set("dqFailed", patch)}>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Lowest severity" htmlFor="dq-severity" help="Failures below it are left alone">
                <Select value={draft.dqFailed.minSeverity} onValueChange={(value) => set("dqFailed", { minSeverity: value as DqSeverity })}><SelectTrigger id="dq-severity" aria-label="Lowest severity"><SelectValue /></SelectTrigger><SelectContent>{SEVERITIES.map((item) => <SelectItem key={item} value={item} className="capitalize">{item[0].toUpperCase() + item.slice(1)}</SelectItem>)}</SelectContent></Select>
              </Field>
              <div className="sm:col-span-2"><Toggle id="dq-warnings" label="Warnings count too" checked={draft.dqFailed.includeWarnings} onChange={(includeWarnings) => set("dqFailed", { includeWarnings })} /></div>
            </div>
            {tables.length > 1 ? (
              <fieldset className="mt-3">
                <legend className="mb-1.5 text-[14px] font-medium text-ink-2">Result tables</legend>
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                  {tables.map((table) => {
                    const id = table.id as string; const checked = !draft.dqFailed.tables.length || draft.dqFailed.tables.includes(id);
                    return <Toggle key={id} id={`dq-table-${id}`} label={table.name || table.resultTable} checked={checked} onChange={(on) => { const all = tables.map((item) => item.id as string); const current = draft.dqFailed.tables.length ? draft.dqFailed.tables : all; const next = on ? [...new Set([...current, id])] : current.filter((item) => item !== id); set("dqFailed", { tables: next.length === all.length ? [] : next }); }} />;
                  })}
                </div>
                <p className="mt-1.5 text-[13px] text-ink-4">All on means every table, including ones added later</p>
              </fieldset>
            ) : null}
          </TriggerBlock>
        </div>
      </SettingsSection>

      <SettingsSection title="Tickets" footer={saveOnly}>
        <p className="-mt-2 mb-4 text-[13.5px] text-ink-4">{usesTicket ? `Where automatic tickets go. ${AGENT_NAME} notes its progress and findings on them, signed as ${AGENT_NAME} via NerveCenter.` : "Used when a trigger opens a ticket."}</p>
        <TicketFields value={draft.ticket} onChange={(patch) => set("ticket", patch)} />
      </SettingsSection>

      <SettingsSection title="Limits" footer={saveOnly}>
        <div className="grid gap-4 sm:grid-cols-2">
          {LIMIT_FIELDS.map((field) => <NumberField key={field.key} id={`limit-${field.key}`} label={field.label} help={field.help} value={draft.limits[field.key]} onChange={(value) => set("limits", { [field.key]: value } as Partial<AutomationLimits>)} />)}
        </div>
      </SettingsSection>

      <SettingsSection title="Exceptions" footer={saveOnly}>
        <p className="-mt-2 mb-4 text-[13.5px] text-ink-4">A pipeline or result table that should be handled differently from the rules above.</p>
        <Exceptions
          heading="Pipelines"
          noun="pipeline"
          triggers={["pipelineFailed", "pipelineLate"]}
          entries={draft.overrides.pipelines}
          choices={(pipelines.data?.items ?? []).map((item) => ({ id: item.pipelineId, label: item.dagName || item.name || item.pipelineId }))}
          defaults={{ pipelineFailed: draft.pipelineFailed.action, pipelineLate: draft.pipelineLate.action }}
          onChange={(next) => setDraft((current) => ({ ...current, overrides: { ...current.overrides, pipelines: next } }))}
        />
        <div className="my-5 border-t border-line" />
        <Exceptions
          heading="Result tables"
          noun="result table"
          triggers={["dqFailed"]}
          entries={draft.overrides.tables}
          choices={tables.map((table) => ({ id: table.id as string, label: table.name || table.resultTable }))}
          defaults={{ dqFailed: draft.dqFailed.action }}
          onChange={(next) => setDraft((current) => ({ ...current, overrides: { ...current.overrides, tables: next } }))}
        />
      </SettingsSection>
    </div>
  );
}

function SaveFooterButton({ pending, disabled, onSave }: { pending: boolean; disabled: boolean; onSave: () => void }) {
  return <Button variant="primary" size="sm" disabled={pending || disabled} onClick={onSave}>{pending ? "Saving" : "Save"}</Button>;
}

/** When each source was last fetched and is fetched next, and what went wrong last. */
function FetchStatus({ status }: { status: MonitoringStatus }) {
  const line = (label: string, source: SourceStatus) => (
    <li className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2">
      <span className="text-[13.5px] font-medium text-ink-2">{label}</span>
      <span className="text-[13px] text-ink-4">
        {source.sharedWith ? `Shared result tables, fetched under ${source.sharedWith}` : source.lastFetchAt ? `Fetched ${formatRelativeTime(source.lastFetchAt)}${source.nextFetchAt ? ` · next ${formatRelativeTime(source.nextFetchAt)}` : ""}` : "Not fetched yet"}
        {source.lastError ? <span className="ml-2 text-rose-700">{source.lastError}</span> : null}
      </span>
    </li>
  );
  return (
    <ul className="divide-y divide-line border-y border-line" aria-label="Background fetch">
      {line("Pipelines", status.sources.pipelines)}
      {line("Data quality", status.sources.dataQuality)}
      <li className="flex items-baseline justify-between gap-3 py-2"><span className="text-[13.5px] font-medium text-ink-2">Open alerts</span><span className="text-[13px] tabular-nums text-ink-4">{status.openAlerts}</span></li>
    </ul>
  );
}

function TriggerBlock<T extends { action: AutomationAction; permission: AutomationPermission; playbook: string }>({ trigger, value, onChange, children }: { trigger: keyof typeof PLAYBOOK_HINT; value: T; onChange: (patch: Partial<T>) => void; children?: ReactNode }) {
  const investigates = value.action === "task" || value.action === "task_and_ticket";
  return (
    <section aria-labelledby={`trigger-${trigger}`}>
      <GroupHeading><span id={`trigger-${trigger}`}>{TRIGGER_LABEL[trigger]}</span></GroupHeading>
      <div className="mt-3 grid gap-4 sm:grid-cols-3">
        <Field label="What happens" htmlFor={`${trigger}-action`} help={ACTION_HELP[value.action]}>
          <Select value={value.action} onValueChange={(action) => onChange({ action } as Partial<T>)}><SelectTrigger id={`${trigger}-action`} aria-label={`${TRIGGER_LABEL[trigger]}: what happens`}><SelectValue /></SelectTrigger><SelectContent>{ACTIONS.map((action) => <SelectItem key={action} value={action}>{ACTION_LABEL[action]}</SelectItem>)}</SelectContent></Select>
        </Field>
        <Field label="Permission" htmlFor={`${trigger}-permission`} help={investigates ? (value.permission === "read-only" ? "Investigates and reports. Changes nothing" : "Everyday changes run; the rest follows Policy") : "Applies when it investigates"} tip={<InfoTip>Automatic investigations start read-only. Follow policy lets {AGENT_NAME} make the changes Policy allows without asking.</InfoTip>}>
          <Select value={value.permission} onValueChange={(permission) => onChange({ permission } as Partial<T>)} disabled={!investigates}><SelectTrigger id={`${trigger}-permission`} aria-label={`${TRIGGER_LABEL[trigger]}: permission`}><SelectValue /></SelectTrigger><SelectContent>{PERMISSIONS.map((permission) => <SelectItem key={permission} value={permission}>{PERMISSION_LABEL[permission]}</SelectItem>)}</SelectContent></Select>
        </Field>
        <Field label="Playbook" htmlFor={`${trigger}-playbook`} help={value.playbook ? "Read first, then checked against the evidence" : "Empty: Sonic searches knowledge for one"}>
          <Input id={`${trigger}-playbook`} className="font-mono text-[13px]" value={value.playbook} placeholder={PLAYBOOK_HINT[trigger]} onChange={(event) => onChange({ playbook: event.target.value.trim() } as Partial<T>)} disabled={!investigates} />
        </Field>
      </div>
      {children && value.action !== "off" ? <div className="mt-4">{children}</div> : null}
    </section>
  );
}

function TicketFields({ value, onChange }: { value: AutomationTicket; onChange: (patch: Partial<AutomationTicket>) => void }) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Field label="Open in" htmlFor="ticket-platform" help="Falls back to NerveCenter when that platform is not connected">
        <Select value={value.platform} onValueChange={(platform) => onChange({ platform: platform as TicketPlatformChoice })}><SelectTrigger id="ticket-platform" aria-label="Open tickets in"><SelectValue /></SelectTrigger><SelectContent>{TICKET_PLATFORMS.map(([id, label]) => <SelectItem key={id} value={id}>{label}</SelectItem>)}</SelectContent></Select>
      </Field>
      <Field label="Priority" htmlFor="ticket-priority" help="By what happened: failures high, late runs medium, checks by severity">
        <Select value={value.priority} onValueChange={(priority) => onChange({ priority: priority as TicketPriorityChoice })}><SelectTrigger id="ticket-priority" aria-label="Ticket priority"><SelectValue /></SelectTrigger><SelectContent>{PRIORITIES.map(([id, label]) => <SelectItem key={id} value={id}>{label}</SelectItem>)}</SelectContent></Select>
      </Field>
      <Field label="When it recovers" htmlFor="ticket-recovery" help="A healthy run or a passing check closes the alert">
        <Select value={value.onRecovery} onValueChange={(onRecovery) => onChange({ onRecovery: onRecovery as RecoveryAction })}><SelectTrigger id="ticket-recovery" aria-label="When it recovers"><SelectValue /></SelectTrigger><SelectContent>{RECOVERY.map(([id, label]) => <SelectItem key={id} value={id}>{label}</SelectItem>)}</SelectContent></Select>
      </Field>
      {value.platform === "servicenow" || value.platform === "auto" ? (
        <Field label="Assignment group" htmlFor="ticket-group" help="ServiceNow. Empty uses the instance default">
          <Input id="ticket-group" value={value.assignmentGroup} onChange={(event) => onChange({ assignmentGroup: event.target.value })} placeholder="Data Operations" />
        </Field>
      ) : null}
      {value.platform === "jira" || value.platform === "auto" ? (
        <>
          <Field label="Jira project key" htmlFor="ticket-project" help="Empty uses the Jira connection's project">
            <Input id="ticket-project" value={value.projectKey} onChange={(event) => onChange({ projectKey: event.target.value.trim().toUpperCase() })} placeholder="DATAOPS" />
          </Field>
          <Field label="Jira issue type" htmlFor="ticket-type">
            <Input id="ticket-type" value={value.issueType} onChange={(event) => onChange({ issueType: event.target.value })} placeholder="Task" />
          </Field>
        </>
      ) : null}
    </div>
  );
}

type TriggerKey = "pipelineFailed" | "pipelineLate" | "dqFailed";
const SHORT_TRIGGER: Record<TriggerKey, string> = { pipelineFailed: "Failed", pipelineLate: "Late or missed", dqFailed: "Check failed" };

function Exceptions({ heading, noun, triggers, entries, choices, defaults, onChange }: { heading: string; noun: string; triggers: TriggerKey[]; entries: Record<string, AutomationOverride>; choices: Array<{ id: string; label: string }>; defaults: Partial<Record<TriggerKey, AutomationAction>>; onChange: (next: Record<string, AutomationOverride>) => void }) {
  const [adding, setAdding] = useState("");
  const labels = useMemo(() => new Map(choices.map((choice) => [choice.id, choice.label])), [choices]);
  const available = choices.filter((choice) => !entries[choice.id]);
  const actionOf = (entry: AutomationOverride, trigger: TriggerKey) => (entry[trigger]?.action ?? defaults[trigger] ?? "off") as AutomationAction;
  const setAction = (id: string, trigger: TriggerKey, action: AutomationAction) => onChange({ ...entries, [id]: { ...entries[id], [trigger]: { ...(entries[id]?.[trigger] || {}), action } } });
  const remove = (id: string) => { const next = { ...entries }; delete next[id]; onChange(next); };
  const add = () => { if (!adding) return; onChange({ ...entries, [adding]: Object.fromEntries(triggers.map((trigger) => [trigger, { action: defaults[trigger] ?? "off" }])) }); setAdding(""); };
  const ids = Object.keys(entries);
  return (
    <div>
      <GroupHeading action={available.length ? (
        <div className="flex items-center gap-2">
          <Select value={adding} onValueChange={setAdding}><SelectTrigger className="h-8 w-[220px]" aria-label={`Add a ${noun}`}><SelectValue placeholder={`Pick a ${noun}`} /></SelectTrigger><SelectContent>{available.slice(0, 500).map((choice) => <SelectItem key={choice.id} value={choice.id}>{choice.label}</SelectItem>)}</SelectContent></Select>
          <Button size="sm" variant="outline" className="border border-line" disabled={!adding} onClick={add}><Plus className="h-4 w-4" />Add</Button>
        </div>
      ) : null}>{heading}</GroupHeading>
      {ids.length ? (
        <ul className="mt-3 divide-y divide-line border-y border-line" aria-label={`${heading} exceptions`}>
          {ids.map((id) => (
            <li key={id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
              <span className="min-w-0 truncate text-[14px] font-medium text-ink-1" title={id}>{labels.get(id) || id}</span>
              <span className="flex flex-wrap items-center gap-2">
                {triggers.map((trigger) => (
                  <label key={trigger} className="flex items-center gap-1.5 text-[12.5px] text-ink-4">{SHORT_TRIGGER[trigger]}
                    <Select value={actionOf(entries[id], trigger)} onValueChange={(action) => setAction(id, trigger, action as AutomationAction)}><SelectTrigger className="h-8 w-[180px]" aria-label={`${labels.get(id) || id}: ${SHORT_TRIGGER[trigger]}`}><SelectValue /></SelectTrigger><SelectContent>{ACTIONS.map((action) => <SelectItem key={action} value={action}>{ACTION_LABEL[action]}</SelectItem>)}</SelectContent></Select>
                  </label>
                ))}
                <Button size="icon" variant="ghost" aria-label={`Remove the exception for ${labels.get(id) || id}`} onClick={() => remove(id)}><Trash2 className="h-4 w-4" /></Button>
              </span>
            </li>
          ))}
        </ul>
      ) : <p className="mt-2 text-[13.5px] text-ink-4">No exceptions</p>}
    </div>
  );
}

function NumberField({ id, label, help, value, onChange, step = 1, disabled = false }: { id: string; label: string; help?: string; value: number; onChange: (value: number) => void; step?: number; disabled?: boolean }) {
  return (
    <Field label={label} htmlFor={id} help={help}>
      <Input id={id} type="number" inputMode="decimal" step={step} className="w-28" value={Number.isFinite(value) ? value : ""} disabled={disabled} onChange={(event) => onChange(event.target.value === "" ? Number.NaN : Number(event.target.value))} />
    </Field>
  );
}

function Toggle({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label htmlFor={id} className="flex items-center gap-2 text-[13.5px] text-ink-2"><Switch id={id} aria-label={label} checked={checked} onCheckedChange={onChange} />{label}</label>;
}


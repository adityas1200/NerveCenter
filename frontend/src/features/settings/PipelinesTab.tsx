import { refreshAfterWrite } from "@/lib/refreshAfterWrite";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { automationApi } from "@/api/automation";
import { ApiError } from "@/api/client";
import { connectorKeys, connectorsApi, type Connector } from "@/api/connectors";
import { queryKeys } from "@/api/queryKeys";
import type { JobFilter, Operations, PlatformSettings } from "@/api/settings";
import { AlertDialog, Badge, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, useToast } from "@/components/ui";
import { Field, SettingsSection } from "./SettingsShell";
import { useSaveSection } from "./useSaveSection";
import { platformLabel } from "@/lib/platform";
import { FRESH } from "@/api/queryPolicy";

/**
 * Pipelines: the data platforms whose jobs the Pipelines page lists (operations.yaml `platforms`).
 * Each platform uses a connection from Connectors and may narrow its jobs with a name filter,
 * stored as `monitoring.jobs = { include, exclude }`.
 */

const PLATFORM_TYPES = ["databricks", "snowflake"].map((id) => ({ id, label: platformLabel(id) as string }));
const isPlatformType = (name: string) => PLATFORM_TYPES.some((item) => item.id === name);

const envKey = (platform: PlatformSettings) => { const environments = platform.environments || {}; return environments.default ? "default" : environments.prod ? "prod" : Object.keys(environments)[0] || "default"; };
function workspaceOf(platform: PlatformSettings): string {
  const env = platform.environments?.[envKey(platform)] || {};
  return String(env.workspace || env.account || "");
}
function filterOf(platform: PlatformSettings): { include: string[]; exclude: string[] } {
  const jobs = platform.monitoring?.jobs;
  if (!jobs || typeof jobs !== "object") return { include: [], exclude: [] };
  const list = (value: JobFilter["include"]) => (Array.isArray(value) ? value.map(String).filter(Boolean) : []);
  return { include: list(jobs.include), exclude: list(jobs.exclude) };
}
function describeFilter(platform: PlatformSettings): string {
  const { include, exclude } = filterOf(platform);
  if (!include.length && !exclude.length) return "All jobs";
  return [include.length ? `Only ${include.join(", ")}` : "All jobs", exclude.length ? `except ${exclude.join(", ")}` : ""].filter(Boolean).join(" ");
}
const splitTerms = (text: string) => [...new Set(text.split(",").map((term) => term.trim()).filter(Boolean))];

/** Readiness of the connection a platform uses, from the Connectors page. */
function ConnectionState({ name, connector, known }: { name?: string; connector?: Connector; known: boolean }) {
  if (!name) return <Badge variant="secondary">No connection</Badge>;
  if (!known || !connector) return <Badge variant="secondary" title="Add it on Connectors">Not on Connectors</Badge>;
  if (connector.state === "connected") return <Badge variant="emerald">Ready</Badge>;
  if (connector.state === "error") return <Badge variant="rose" title={connector.reason || undefined}>Needs attention</Badge>;
  return <Badge variant="secondary" title={connector.reason || undefined}>Not connected</Badge>;
}

export function PipelinesTab({ operations }: { operations: Operations }) {
  const save = useSaveSection({ successMessage: "Platforms saved" });
  const connectors = useQuery({ queryKey: connectorKeys.all, queryFn: ({ signal }) => connectorsApi.list(signal), staleTime: FRESH.medium });
  const platforms = operations.platforms || [];
  const connectionNames = Object.keys(operations.connections || {});
  const connectorById = new Map((connectors.data?.items || []).map((item) => [item.id, item]));
  const [editing, setEditing] = useState<{ index: number | null } | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);
  const queryClient = useQueryClient();
  const toast = useToast();
  // The Pipelines page reads the last fetch, which is filtered when it is fetched, so a saved platform or
  // filter shows only after a new fetch: ask for one now, then mark the page's data stale (SPEC-pipelines-03 FR-8).
  const applyToPipelines = async () => {
    try { await automationApi.refresh(["pipelines"]); }
    catch (error) {
      if (error instanceof ApiError && error.status === 429) toast.info("Pipelines update at the next fetch", "A refresh ran in the last 30 seconds.");
      else toast.error("Pipelines not refreshed", "Saved. Use refresh on the Pipelines page to see the change.");
    }
    finally { await Promise.all([refreshAfterWrite(queryClient, { queryKey: queryKeys.monitor.all }), refreshAfterWrite(queryClient, { queryKey: queryKeys.overview.all })]); }
  };
  const write = async (next: PlatformSettings[]) => { await save.mutateAsync({ section: "platforms", value: next }); void applyToPipelines(); };
  const add = <Button size="sm" variant="outline" className="border border-line" onClick={() => setEditing({ index: null })}><Plus className="h-4 w-4" />Add platform</Button>;

  return (
    <SettingsSection title="Pipelines" action={add}>
      <p className="-mt-2 text-[13.5px] text-ink-4">Platforms whose jobs appear on the Pipelines page.</p>
      {platforms.length ? (
        <ul className="mt-3 divide-y divide-line border-y border-line" aria-label="Platforms">
          {platforms.map((platform, index) => {
            const workspace = workspaceOf(platform);
            const filter = describeFilter(platform);
            return (
              <li key={`${platform.name}-${index}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,180px)_auto]">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold text-ink-1" title={platform.name}>{platform.name} <span className="font-normal text-ink-4">· {platformLabel(platform.type) || platform.type}</span></p>
                  {workspace ? <p className="truncate font-mono text-[12.5px] text-ink-4" title={workspace}>{workspace}</p> : null}
                  <p className="truncate text-[13px] text-ink-3" title={filter}>{filter}</p>
                </div>
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-[13.5px] text-ink-3" title={platform.connection}>{platform.connection || "—"}</span>
                  <ConnectionState name={platform.connection} connector={platform.connection ? connectorById.get(platform.connection) : undefined} known={Boolean(platform.connection && connectionNames.includes(platform.connection))} />
                </div>
                <div className="col-span-2 flex justify-end gap-1 sm:col-span-1">
                  <Button size="sm" variant="outline" className="border border-line" onClick={() => setEditing({ index })} aria-label={`Edit ${platform.name}`}><Pencil className="h-3.5 w-3.5" />Edit</Button>
                  <Button size="icon" variant="ghost" onClick={() => setRemoving(index)} aria-label={`Remove ${platform.name}`}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : <p className="mt-4 text-[13.5px] text-ink-4">No platforms</p>}
      {editing ? (
        <PlatformDialog
          platform={editing.index === null ? null : platforms[editing.index]}
          others={platforms.filter((_, i) => i !== editing.index).map((platform) => platform.name)}
          connectionNames={connectionNames}
          connectors={connectors.data?.items || []}
          pending={save.isPending}
          error={save.error}
          onClose={() => { save.reset(); setEditing(null); }}
          onSave={async (platform) => {
            const next = editing.index === null ? [...platforms, platform] : platforms.map((item, i) => (i === editing.index ? platform : item));
            await write(next).then(() => setEditing(null)).catch(() => undefined);
          }}
        />
      ) : null}
      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => { if (!open) setRemoving(null); }}
        destructive
        title={`Remove ${removing !== null ? platforms[removing]?.name : "platform"}?`}
        description="Its jobs disappear from the Pipelines page. Nothing changes on the platform."
        confirmLabel="Remove"
        onConfirm={async () => { if (removing !== null) await write(platforms.filter((_, i) => i !== removing)); setRemoving(null); }}
      />
    </SettingsSection>
  );
}

function PlatformDialog({ platform, others, connectionNames, connectors, pending, error, onClose, onSave }: {
  platform: PlatformSettings | null; others: string[]; connectionNames: string[]; connectors: Connector[]; pending: boolean; error: unknown;
  onClose: () => void; onSave: (platform: PlatformSettings) => void;
}) {
  // Pipeline platforms first; every connection on Connectors that operations.yaml knows stays selectable.
  const choices = [...connectionNames].sort((a, b) => Number(!isPlatformType(a)) - Number(!isPlatformType(b)) || a.localeCompare(b));
  const firstChoice = choices.find(isPlatformType) || choices[0] || "";
  const initialFilter = platform ? filterOf(platform) : { include: [], exclude: [] };
  const [name, setName] = useState(platform?.name || (others.length ? "" : "analytics"));
  const [connection, setConnection] = useState(platform?.connection || firstChoice);
  const [type, setType] = useState(platform?.type || (isPlatformType(firstChoice) ? firstChoice : "databricks"));
  const [workspace, setWorkspace] = useState(platform ? workspaceOf(platform) : "");
  const [include, setInclude] = useState(initialFilter.include.join(", "));
  const [exclude, setExclude] = useState(initialFilter.exclude.join(", "));
  const [touched, setTouched] = useState(false);
  const trimmed = name.trim();
  const nameError = !trimmed ? "Name is required" : others.some((other) => other.trim().toLowerCase() === trimmed.toLowerCase()) ? "Another platform has this name" : !/^[A-Za-z0-9._-]+$/.test(trimmed) ? "Use letters, numbers, dot, dash or underscore" : null;
  const connectionError = !connection ? "Pick a connection" : null;
  const snowflake = type === "snowflake";
  const stateOf = (id: string) => connectors.find((item) => item.id === id)?.state;

  const submit = () => {
    setTouched(true);
    if (nameError || connectionError) return;
    const base: PlatformSettings = platform ? { ...platform } : { name: trimmed, type, environments: { default: { writable: false } } };
    const environments = { ...(base.environments || {}) };
    const key = envKey(base);
    const env = { ...(environments[key] || { writable: false }) };
    delete env.workspace; delete env.account;
    if (workspace.trim()) env[snowflake ? "account" : "workspace"] = workspace.trim();
    environments[key] = env;
    const includeTerms = splitTerms(include); const excludeTerms = splitTerms(exclude);
    const previousJobs = base.monitoring?.jobs;
    // A filter replaces the jobs entry; with no filter the plugin's free-text description (a string) is kept.
    const jobs = includeTerms.length || excludeTerms.length ? { include: includeTerms, exclude: excludeTerms } : typeof previousJobs === "string" ? previousJobs : undefined;
    const monitoring = { ...(base.monitoring || {}), jobs };
    if (jobs === undefined) delete monitoring.jobs;
    onSave({ ...base, name: trimmed, type, connection, environments, ...(Object.keys(monitoring).length ? { monitoring } : { monitoring: undefined }) });
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{platform ? `Edit ${platform.name}` : "Add platform"}</DialogTitle>
          <DialogDescription>A Databricks or Snowflake workspace whose jobs the Pipelines page lists.</DialogDescription>
        </DialogHeader>
        <div className="grid min-w-0 gap-4 px-5 pb-2 sm:grid-cols-2">
          <Field label="Connection" htmlFor="platform-connection" help="Set up on Connectors">
            {choices.length ? (
              <Select value={connection} onValueChange={(value) => { setConnection(value); if (isPlatformType(value)) setType(value); }}>
                <SelectTrigger id="platform-connection" aria-label="Connection" aria-invalid={Boolean(touched && connectionError)}><SelectValue placeholder="Pick a connection" /></SelectTrigger>
                <SelectContent>{choices.map((choice) => <SelectItem key={choice} value={choice}>{choice}{stateOf(choice) === "connected" ? " · Ready" : stateOf(choice) === "error" ? " · Needs attention" : stateOf(choice) ? " · Not connected" : ""}</SelectItem>)}</SelectContent>
              </Select>
            ) : <Link id="platform-connection" to="/connectors" className="inline-flex h-9 items-center text-[14px] text-brand hover:underline">Add a connection on Connectors</Link>}
            {touched && connectionError && choices.length ? <p role="alert" className="mt-1 text-[13px] text-rose-700">{connectionError}</p> : null}
          </Field>
          <Field label="Type" htmlFor="platform-type">
            <Select value={type} onValueChange={setType}><SelectTrigger id="platform-type" aria-label="Type"><SelectValue /></SelectTrigger><SelectContent>{PLATFORM_TYPES.map((item) => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}</SelectContent></Select>
          </Field>
          <Field label="Name" htmlFor="platform-name" help="Short id used in schedules and reports">
            <Input id="platform-name" value={name} onChange={(event) => setName(event.target.value)} aria-invalid={Boolean(touched && nameError)} placeholder="analytics" />
            {touched && nameError ? <p role="alert" className="mt-1 text-[13px] text-rose-700">{nameError}</p> : null}
          </Field>
          <Field label={snowflake ? "Account" : "Workspace"} htmlFor="platform-workspace" help={snowflake ? "Snowflake account identifier" : "Databricks workspace URL"}>
            <Input id="platform-workspace" value={workspace} onChange={(event) => setWorkspace(event.target.value)} placeholder={snowflake ? "org-account" : "adb-123.azuredatabricks.net"} />
          </Field>
          <Field label="Show only jobs named" htmlFor="platform-include" className="sm:col-span-2" help="Comma-separated. Matches part of the name, any case. Empty shows every job">
            <Input id="platform-include" value={include} onChange={(event) => setInclude(event.target.value)} placeholder="sales, nbrx" />
          </Field>
          <Field label="Hide jobs named" htmlFor="platform-exclude" className="sm:col-span-2" help="Comma-separated. Wins over the list above">
            <Input id="platform-exclude" value={exclude} onChange={(event) => setExclude(event.target.value)} placeholder="_dev, test" />
          </Field>
          {error ? <p role="alert" className="break-words rounded-xl border border-rose-200 bg-rose-50 p-3 text-[13px] text-rose-800 sm:col-span-2">{error instanceof Error ? error.message : "Not saved"}</p> : null}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={pending} onClick={submit}>{pending ? "Saving" : "Save"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

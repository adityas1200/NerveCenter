import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, ChevronRight, XCircle } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient } from "@/api/client";
import { routineKeys, routinesApi, TIMEZONES, WEEKDAYS, type Routine, type RoutineCheck, type RoutineInput, type RoutineNotify, type ScheduleKind } from "@/api/routines";
import type { TaskPermission } from "@/api/tasks";
import { useIsAdmin } from "@/auth/rbac";
import { AutonomyDial } from "@/components/ops/AutonomyDial";
import { TimeOfDayPicker } from "@/components/ops/TimeOfDayPicker";
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";
import { connectionLabel, plainCheckDetail } from "./routineText";
import { useConnectionNames } from "./useConnectionNames";
import { useAction } from "@/lib/useAction";
import { FRESH } from "@/api/queryPolicy";
import { settingsKeys } from "@/api/settings";
import { taskKeys } from "@/api/tasks";

/**
 * Create or edit a routine. Plain questions: what should happen, when, where the result goes.
 * Advanced holds connections, permission, notifications and a raw cron. Check setup and Test run
 * are available once the routine exists.
 */

const KIND_LABEL: Record<ScheduleKind, string> = { weekday: "Every weekday", daily: "Every day", weekly: "Weekly", monthly: "Monthly", hours: "Every few hours", manual: "Only when I run it", custom: "Custom (cron)" };
const NOTIFY_LABEL: Record<RoutineNotify, string> = { on_complete: "When a run completes", on_failure: "Only when a run fails", never: "Never" };

interface Draft { title: string; objective: string; kind: ScheduleKind; time: string; timezone: string; weekday: number; dayOfMonth: number; everyHours: number; cron: string; permission: TaskPermission; notify: RoutineNotify; connections: string[] }

/** A new routine runs in the reader's own timezone; the backend falls back to the workspace timezone when none is sent. */
function browserTimezone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}

function draftFrom(routine?: Routine | null): Draft {
  const expression = routine?.trigger.expression || "";
  const parts = expression.split(" ");
  const time = parts.length === 5 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1]) ? `${parts[1].padStart(2, "0")}:${parts[0].padStart(2, "0")}` : "09:00";
  let kind: ScheduleKind = "weekday";
  if (!routine) kind = "weekday";
  else if (routine.trigger.type !== "schedule") kind = "manual";
  else if (parts[4] === "1-5" && parts[2] === "*") kind = "weekday";
  else if (parts[4] === "*" && parts[2] === "*" && /^\d+$/.test(parts[1])) kind = "daily";
  else if (/^\d$/.test(parts[4]) && parts[2] === "*") kind = "weekly";
  else if (/^\d+$/.test(parts[2]) && parts[4] === "*") kind = "monthly";
  else if (parts[1]?.startsWith("*/")) kind = "hours";
  else kind = "custom";
  return { title: routine?.title || "", objective: routine?.objective || "", kind, time, timezone: routine?.trigger.timezone || browserTimezone(), weekday: kind === "weekly" ? Number(parts[4]) : 1, dayOfMonth: kind === "monthly" ? Number(parts[2]) : 1, everyHours: kind === "hours" ? Number(parts[1].slice(2)) || 2 : 2, cron: expression, permission: routine?.permission || "policy", notify: routine?.notify || "on_complete", connections: routine?.connections || [] };
}

function toInput(draft: Draft, existing?: Routine | null): RoutineInput {
  const schedule = draft.kind === "manual" ? null : draft.kind === "custom" ? { cron: draft.cron, timezone: draft.timezone } : { kind: draft.kind, time: draft.time, timezone: draft.timezone, weekday: draft.weekday, dayOfMonth: draft.dayOfMonth, everyHours: draft.everyHours };
  return { name: existing?.name, title: draft.title.trim() || draft.objective.trim().split(/[.!?\n]/)[0].slice(0, 60), objective: draft.objective.trim(), schedule, permission: draft.permission, notify: draft.notify, connections: draft.connections, enabled: existing ? existing.enabled : true };
}

export function RoutineDialog({ open, onOpenChange, routine }: { open: boolean; onOpenChange: (open: boolean) => void; routine?: Routine | null }) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(routine));
  const [advanced, setAdvanced] = useState(false);
  const [check, setCheck] = useState<RoutineCheck | null>(null);
  useEffect(() => { if (open) { setDraft(draftFrom(routine)); setAdvanced(false); setCheck(null); } }, [open, routine]);
  const settings = useQuery({ queryKey: settingsKeys.all, queryFn: ({ signal }) => apiClient.get<{ operations: { connections?: Record<string, unknown> } }>("/api/settings", { signal }), enabled: open, staleTime: FRESH.long });
  const knownConnections = useMemo(() => Object.keys(settings.data?.operations.connections || {}), [settings.data]);
  const names = useConnectionNames(open);
  const admin = useIsAdmin();
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const keys = [routineKeys.all, taskKeys.all];

  const save = useAction({
    mutationFn: () => routine ? routinesApi.update(routine.name, toInput(draft, routine)) : routinesApi.create(toInput(draft)),
    invalidate: keys,
    success: (saved) => [routine ? "Routine updated" : "Routine created", saved.scheduleText],
    onSuccess: (saved) => { onOpenChange(false); if (!routine) navigate(`/routines/${encodeURIComponent(saved.name)}`); },
    error: "Routine not saved",
  });
  const runCheck = useAction({ mutationFn: () => routinesApi.check(routine?.name || ""), onSuccess: setCheck, error: "Check failed" });
  const testRun = useAction({
    mutationFn: () => routinesApi.test(routine?.name || ""),
    invalidate: keys,
    success: ["Test run started", "Preview mode: no changes will be made."],
    onSuccess: (task) => { onOpenChange(false); navigate(`/tasks/${encodeURIComponent(task.id)}`); },
    error: "Test not started",
  });
  const valid = draft.objective.trim().length > 0 && (draft.kind !== "custom" || draft.cron.trim().split(/\s+/).length === 5);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{routine ? "Edit routine" : "Create routine"}</DialogTitle><DialogDescription>What should run, and when.</DialogDescription></DialogHeader>
        <div className="max-h-[70vh] space-y-5 overflow-y-auto px-5 pb-5">
          <Field label="What should happen?" htmlFor="routine-objective">
            <Textarea id="routine-objective" rows={3} value={draft.objective} onChange={(event) => set("objective", event.target.value)} placeholder="Review my assigned Jira tickets. Group them by type, highlight blockers and SLA risks, and tell me which ticket I should start next." />
          </Field>
          <Field label="Name" htmlFor="routine-title" hint="Optional. Taken from the first sentence when empty.">
            <Input id="routine-title" value={draft.title} onChange={(event) => set("title", event.target.value)} placeholder="Daily ticket review" />
          </Field>
          <div>
            <p className="text-[13.5px] font-semibold text-ink-2">When should it run?</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <Select value={draft.kind} onValueChange={(value) => set("kind", value as ScheduleKind)}><SelectTrigger aria-label="Schedule"><SelectValue /></SelectTrigger><SelectContent>{(Object.keys(KIND_LABEL) as ScheduleKind[]).map((kind) => <SelectItem key={kind} value={kind}>{KIND_LABEL[kind]}</SelectItem>)}</SelectContent></Select>
              {["weekday", "daily", "weekly", "monthly"].includes(draft.kind) ? <TimeOfDayPicker aria-label="Time" value={draft.time} onChange={(value) => set("time", value)} /> : null}
              {draft.kind === "weekly" ? <Select value={String(draft.weekday)} onValueChange={(value) => set("weekday", Number(value))}><SelectTrigger aria-label="Day of week"><SelectValue /></SelectTrigger><SelectContent>{WEEKDAYS.map((day, index) => <SelectItem key={day} value={String(index)}>{day}</SelectItem>)}</SelectContent></Select> : null}
              {draft.kind === "monthly" ? <Input aria-label="Day of month" type="number" min={1} max={31} value={draft.dayOfMonth} onChange={(event) => set("dayOfMonth", Number(event.target.value))} /> : null}
              {draft.kind === "hours" ? <Input aria-label="Every how many hours" type="number" min={1} max={23} value={draft.everyHours} onChange={(event) => set("everyHours", Number(event.target.value))} /> : null}
              {draft.kind === "custom" ? <Input aria-label="Cron expression" className="font-mono" value={draft.cron} onChange={(event) => set("cron", event.target.value)} placeholder="0 9 * * 1-5" /> : null}
            </div>
            {draft.kind !== "manual" ? <div className="mt-2 flex items-center gap-3 text-[13.5px] text-ink-3"><span className="w-20">Timezone</span><Select value={draft.timezone} onValueChange={(value) => set("timezone", value)}><SelectTrigger aria-label="Timezone" className="w-[220px]"><SelectValue /></SelectTrigger><SelectContent>{[...new Set([draft.timezone, ...TIMEZONES])].map((zone) => <SelectItem key={zone} value={zone}>{zone}</SelectItem>)}</SelectContent></Select></div> : null}
          </div>
          <div>
            <p className="text-[13.5px] font-semibold text-ink-2">Where should the result appear?</p>
            <div className="mt-2 rounded-xl border border-line bg-surface-subtle px-3 py-2.5 text-[13.5px] text-ink-2">Tasks<span className="block text-[12.5px] text-ink-4">Each run shows up as a new task in your task list.</span></div>
          </div>
          <div className="border-t border-line pt-4">
            <button type="button" className="flex items-center gap-1.5 text-[13.5px] font-semibold text-brand" onClick={() => setAdvanced((value) => !value)} aria-expanded={advanced}>{advanced ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}Advanced</button>
            {advanced ? (
              <div className="mt-3 space-y-3 rounded-xl border border-line bg-raised p-3">
                <Row label="Connections" hint="The routine uses your connected accounts.">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {knownConnections.length ? knownConnections.map((name) => <button key={name} type="button" onClick={() => set("connections", draft.connections.includes(name) ? draft.connections.filter((item) => item !== name) : [...draft.connections, name])} className={cn("rounded-md border px-2 py-0.5 text-[12.5px] font-medium", draft.connections.includes(name) ? "border-ink-1 bg-ink-1 text-raised" : "border-line bg-raised text-ink-3 hover:border-line-strong")} aria-pressed={draft.connections.includes(name)} title={name}>{connectionLabel(name, names)}</button>) : <span className="text-[13px] text-ink-4">No connections yet. Add them in Connectors.</span>}
                    {routine ? <Button size="sm" variant="outline" className="ml-auto border border-line" disabled={runCheck.isPending} busy={runCheck.isPending} onClick={() => runCheck.mutate()}>{runCheck.isPending ? "Checking…" : "Check setup"}</Button> : null}
                  </div>
                </Row>
                <Row label="Permission" hint="Limit what the routine can do in connected systems.">
                  <AutonomyDial label="Permission" value={draft.permission} onChange={(value) => set("permission", value)} allowUnrestricted={admin} />
                </Row>
                <Row label="Notify me" hint="A note lands in the Inbox.">
                  <Select value={draft.notify} onValueChange={(value) => set("notify", value as RoutineNotify)}><SelectTrigger aria-label="Notify me" className="w-[220px]"><SelectValue /></SelectTrigger><SelectContent>{(Object.keys(NOTIFY_LABEL) as RoutineNotify[]).map((value) => <SelectItem key={value} value={value}>{NOTIFY_LABEL[value]}</SelectItem>)}</SelectContent></Select>
                </Row>
              </div>
            ) : null}
          </div>
          {check ? (
            <div className="rounded-xl border border-line bg-raised p-3">
              <div className="flex items-center justify-between"><p className="text-[13.5px] font-semibold text-ink-2">Check setup</p><span className="text-[12.5px] text-ink-5">Checked just now</span></div>
              <ul className="mt-2 space-y-1.5">{check.checks.map((item) => <li key={item.id} className="flex items-start gap-2 text-[13.5px]">{item.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-label="OK" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" aria-label="Problem" />}<span><span className="text-ink-1">{item.title}</span><span className="block text-[12.5px] text-ink-4">{plainCheckDetail(item.detail)}</span></span></li>)}</ul>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            {routine ? <Button variant="outline" className="border border-line" disabled={testRun.isPending} busy={testRun.isPending} onClick={() => testRun.mutate()}>Test run</Button> : null}
            <Button variant="primary" disabled={!valid || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : routine ? "Save changes" : "Create routine"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: ReactNode }) {
  return <div><label htmlFor={htmlFor} className="text-[13.5px] font-semibold text-ink-2">{label}</label><div className="mt-2">{children}</div>{hint ? <p className="mt-1 text-[12.5px] text-ink-4">{hint}</p> : null}</div>;
}
function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <div className="grid gap-2 sm:grid-cols-[130px_1fr]"><div><p className="text-[13.5px] font-medium text-ink-2">{label}</p>{hint ? <p className="text-[11.5px] text-ink-4">{hint}</p> : null}</div><div>{children}</div></div>;
}

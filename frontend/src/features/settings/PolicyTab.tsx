import { useQuery } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { inboxApi, inboxKeys, type ApprovalStats } from "@/api/inbox";
import { CLOSURE_OPTIONS, EMPTY_RULE, POLICY_DEFAULTS, POLICY_OPTIONS, RECIPIENT_OPTIONS, RULE_ACTION_OPTIONS, RULE_EFFECT_OPTIONS, RULE_SYSTEM_OPTIONS, RULE_TYPE_OPTIONS, joinResource, splitResource, type Operations, type PolicyRule, type PolicySettings, type PolicyValue, type RuleEffect } from "@/api/settings";
import { AGENT_NAME } from "@/components/ops/agentPanelContext";
import { AlertDialog, Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui";
import { cn } from "@/lib/utils";
import { GroupHeading, SaveFooter, SettingsSection } from "./SettingsShell";
import { isDirty, useSaveSection } from "./useSaveSection";
import { FRESH } from "@/api/queryPolicy";

/**
 * Policy: what a task that follows policy may do without asking. The approval gate
 * (backend/src/tasks/permission-policy.mjs) puts every tool call in one of these categories;
 * reads never ask. The last two rows are rules the agent applies itself.
 */

type Option = { value: PolicyValue; label: string };
interface PolicyRow { key: keyof PolicySettings & string; label: string; help: string; options: ReadonlyArray<Option> }

const GATE_ROWS: PolicyRow[] = [
  { key: "default_write", label: "Routine changes", help: "Commenting on or assigning tickets, editing files, anything not listed below", options: POLICY_OPTIONS },
  { key: "ticket_writes", label: "Ticket changes", help: "Creating, closing or moving tickets in ServiceNow, Jira or NerveCenter", options: POLICY_OPTIONS },
  { key: "production_changes", label: "Production changes", help: "Running, repairing or cancelling jobs, SQL that changes data, git push", options: POLICY_OPTIONS },
  { key: "privileged_access", label: "Access changes", help: "Granting or revoking access: identity groups, SQL GRANT and REVOKE", options: POLICY_OPTIONS },
  { key: "email_send", label: "Sending email", help: "Any email Sonic sends", options: POLICY_OPTIONS },
  { key: "workspace_changes", label: "Workspace setup", help: "Editing operations.yaml, knowledge, workflows and skills", options: POLICY_OPTIONS },
  { key: "knowledge_drafts", label: "Knowledge drafts", help: "Saving a lesson as a draft after verified work; a person keeps or discards it on the Knowledge page", options: POLICY_OPTIONS },
];

const AGENT_ROWS: PolicyRow[] = [
  { key: "ticket_close", label: "Closing tickets", help: "Close only once the fix is verified, or at any time", options: CLOSURE_OPTIONS },
  { key: "external_recipients", label: "Email outside the company", help: "Whether email may go to addresses outside the organization", options: RECIPIENT_OPTIONS },
];

const draftOf = (operations: Operations): PolicySettings => ({ ...POLICY_DEFAULTS, ...operations.policy });

/** Days of approval history shown beside each category. */
const STATS_DAYS = 30;
/** Approvals with no denial before the tab offers to stop asking for a category. */
const WIDEN_AFTER_APPROVALS = 5;

type CategoryStats = ApprovalStats["categories"][number];

/** `readOnly` shows the policy to members without the controls being live; only admins can save. */
export function PolicyTab({ operations, readOnly = false }: { operations: Operations; readOnly?: boolean }) {
  const save = useSaveSection();
  const [policy, setPolicy] = useState<PolicySettings>(() => draftOf(operations));
  const [widening, setWidening] = useState<PolicyRow | null>(null);
  useEffect(() => { setPolicy(draftOf(operations)); }, [operations]);
  // The environments a rule can name come from the platforms already configured in operations.yaml.
  const environments = useMemo(() => {
    const names = (operations.platforms ?? []).flatMap((platform) => Object.keys(platform.environments ?? {}));
    return ["*", ...Array.from(new Set(names))];
  }, [operations.platforms]);
  const rules = policy.rules ?? [];
  const setRules = (next: PolicyRule[]) => { if (!readOnly) setPolicy((current) => ({ ...current, rules: next })); };
  const stats = useQuery({ queryKey: inboxKeys.stats(STATS_DAYS), queryFn: ({ signal }) => inboxApi.stats(STATS_DAYS, signal), staleTime: FRESH.long });
  const statsFor = (key: string): CategoryStats | null => (stats.data?.categories ?? []).find((item) => item.category === key) ?? null;
  const set = (key: string, value: PolicyValue) => { if (!readOnly) setPolicy((current) => ({ ...current, [key]: value })); };
  const savePolicy = (next: PolicySettings) => save.mutate({ section: "policy", value: { ...operations.policy, ...next } });
  const widen = () => {
    if (!widening) return;
    const next = { ...policy, [widening.key]: "allow" as PolicyValue };
    setPolicy(next);
    savePolicy(next);
    setWidening(null);
  };
  return (
    <SettingsSection title="Policy" action={readOnly ? <span className="text-[13px] text-ink-4">Only owners can change this</span> : undefined} footer={readOnly ? undefined : <SaveFooter pending={save.isPending} disabled={!isDirty(policy, draftOf(operations))} onSave={() => savePolicy(policy)} />}>
      <p className="-mt-2 text-[13.5px] text-ink-4">Applies to every task that follows policy (the default). Look only tasks never change anything.</p>
      <PolicyRows rows={GATE_ROWS} policy={policy} onChange={set} disabled={readOnly} statsFor={stats.data ? statsFor : undefined} onWiden={readOnly ? undefined : setWidening} />
      <div className="mt-5 border-t border-line pt-5">
        <GroupHeading>Rules {AGENT_NAME} follows</GroupHeading>
        <PolicyRows rows={AGENT_ROWS} policy={policy} onChange={set} disabled={readOnly} />
      </div>
      <div className="mt-5 border-t border-line pt-5">
        <div className="flex items-center justify-between">
          <GroupHeading>Exceptions</GroupHeading>
          {readOnly ? null : <Button size="sm" variant="ghost" className="text-brand" onClick={() => setRules([...rules, { ...EMPTY_RULE }])}>Add exception</Button>}
        </div>
        <p className="-mt-1 text-[13px] text-ink-4">
          Narrow or widen one of the answers above for particular systems, environments or objects. The most restrictive
          exception that applies wins, so a Deny here can never be undone by another line. When none apply, the answers above decide.
        </p>
        <RuleRows rules={rules} environments={environments} disabled={readOnly} onChange={setRules} />
      </div>
      <AlertDialog
        open={Boolean(widening)}
        onOpenChange={(open) => { if (!open) setWidening(null); }}
        title={`Let ${AGENT_NAME} do this without asking?`}
        description={widening ? `${AGENT_NAME} will make ${widening.label.toLowerCase()} without asking. You can change this back any time.` : undefined}
        confirmLabel="Stop asking"
        onConfirm={widen}
      />
    </SettingsSection>
  );
}

/** "Approved 14 of 14 in 30 days", or "No requests yet" when nothing in the category has been decided. */
function approvalHistoryText(item: CategoryStats | null, days = STATS_DAYS): string {
  const decided = (item?.approved ?? 0) + (item?.denied ?? 0);
  if (!item || !decided) return "No requests yet";
  return `Approved ${item.approved} of ${decided} in ${days} days`;
}

/** Steady approvals and no denials for a category that still asks: the evidence to stop asking. */
function canWiden(item: CategoryStats | null, value: PolicyValue | undefined): boolean {
  return Boolean(item) && value === "ask" && (item as CategoryStats).approved >= WIDEN_AFTER_APPROVALS && (item as CategoryStats).denied === 0;
}

function PolicyRows({ rows, policy, onChange, disabled, statsFor, onWiden }: { rows: PolicyRow[]; policy: PolicySettings; onChange: (key: string, value: PolicyValue) => void; disabled?: boolean; statsFor?: (key: string) => CategoryStats | null; onWiden?: (row: PolicyRow) => void }) {
  return (
    <div className="mt-2 divide-y divide-line">
      {rows.map((row) => {
        const item = statsFor ? statsFor(row.key) : undefined;
        const value = policy[row.key] as PolicyValue | undefined;
        return (
          <div key={row.key} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
            <div className="min-w-0">
              <p className="text-[14px] font-medium text-ink-2">{row.label}</p>
              <p className="text-[13px] leading-4 text-ink-4">{row.help}</p>
              {item !== undefined ? (
                <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[12.5px] leading-4 text-ink-4" data-testid={`approval-history-${row.key}`}>
                  <span className="tabular-nums">{approvalHistoryText(item)}</span>
                  {onWiden && canWiden(item, value) ? <button type="button" className="font-medium text-brand hover:text-brand-hover" onClick={() => onWiden(row)}>Let {AGENT_NAME} do this without asking</button> : null}
                </p>
              ) : null}
            </div>
            <Segmented label={row.label} value={String(value ?? "")} options={row.options} onChange={(next) => onChange(row.key, next)} disabled={disabled} />
          </div>
        );
      })}
    </div>
  );
}

/**
 * The exceptions list. One row is one statement: an effect, the category it applies to, and the
 * resource it is scoped to, built from four dropdowns so the stored pattern is always well formed.
 * The pattern itself is shown underneath, because that is what lands in operations.yaml.
 */
function RuleRows({ rules, environments, disabled, onChange }: { rules: PolicyRule[]; environments: string[]; disabled?: boolean; onChange: (rules: PolicyRule[]) => void }) {
  if (!rules.length) return <p className="mt-3 rounded-xl border border-dashed border-line px-3 py-4 text-center text-[13px] text-ink-4">No exceptions. The answers above apply everywhere.</p>;
  const replace = (index: number, rule: PolicyRule) => onChange(rules.map((item, i) => (i === index ? rule : item)));
  return (
    <div className="mt-3 space-y-2">
      {rules.map((rule, index) => {
        const parts = splitResource(rule.resource);
        const type = RULE_TYPE_OPTIONS.find((option) => option.value === parts.type) ?? RULE_TYPE_OPTIONS[0];
        const setPart = (key: keyof typeof parts, value: string) => replace(index, { ...rule, resource: joinResource({ ...parts, [key]: value }) });
        return (
          <div key={index} className="rounded-xl border border-line bg-raised p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Picker label={`Exception ${index + 1} effect`} value={rule.effect} options={RULE_EFFECT_OPTIONS} disabled={disabled} width="w-[104px]" onChange={(value) => replace(index, { ...rule, effect: value as RuleEffect })} />
              <Picker label={`Exception ${index + 1} applies to`} value={rule.action} options={RULE_ACTION_OPTIONS} disabled={disabled} width="w-[176px]" onChange={(value) => replace(index, { ...rule, action: value })} />
              <span className="text-[13px] text-ink-4">on</span>
              <Picker label={`Exception ${index + 1} system`} value={parts.system} options={RULE_SYSTEM_OPTIONS} disabled={disabled} width="w-[150px]" onChange={(value) => setPart("system", value)} />
              <Picker label={`Exception ${index + 1} environment`} value={parts.environment} options={environments.map((name) => ({ value: name, label: name === "*" ? "Any environment" : name }))} disabled={disabled} width="w-[152px]" onChange={(value) => setPart("environment", value)} />
              <Picker label={`Exception ${index + 1} kind`} value={parts.type} options={RULE_TYPE_OPTIONS} disabled={disabled} width="w-[132px]" onChange={(value) => setPart("type", value === "*" ? "*" : value)} />
              {parts.type === "*" ? null : (
                // An empty box means every name, which is what the stored `*` says; showing the `*`
                // itself would make clearing the box impossible, since it comes straight back.
                <Input aria-label={`Exception ${index + 1} name pattern`} className="h-8 w-[168px] font-mono text-[12.5px]" value={parts.name === "*" ? "" : parts.name} placeholder={type.placeholder} disabled={disabled} onChange={(event) => setPart("name", event.target.value)} />
              )}
              {disabled ? null : <Button size="icon" variant="ghost" className="ml-auto" aria-label={`Remove exception ${index + 1}`} onClick={() => onChange(rules.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></Button>}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <code className="font-mono text-[12px] text-ink-4">{rule.resource}</code>
              <Input aria-label={`Exception ${index + 1} reason`} className="h-7 min-w-[220px] flex-1 text-[12.5px]" value={rule.description ?? ""} placeholder="Reason shown to Sonic when it is blocked" disabled={disabled} onChange={(event) => replace(index, { ...rule, description: event.target.value })} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Picker({ label, value, options, onChange, disabled, width }: { label: string; value: string; options: ReadonlyArray<{ value: string; label: string }>; onChange: (value: string) => void; disabled?: boolean; width: string }) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger aria-label={label} className={cn("h-8 text-[13px]", width)}><SelectValue /></SelectTrigger>
      <SelectContent>{options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
    </Select>
  );
}

/** A small radio group drawn as a segmented control; arrow keys move between options. */
function Segmented({ label, value, options, onChange, disabled = false }: { label: string; value: string; options: ReadonlyArray<Option>; onChange: (value: string) => void; disabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const index = options.findIndex((option) => option.value === value);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    event.preventDefault();
    const next = ((index < 0 ? 0 : index) + (event.key === "ArrowRight" ? 1 : -1) + options.length) % options.length;
    onChange(String(options[next].value));
    ref.current?.querySelectorAll<HTMLButtonElement>("[role=radio]")[next]?.focus();
  };
  return (
    <div ref={ref} role="radiogroup" aria-label={label} aria-disabled={disabled || undefined} tabIndex={-1} onKeyDown={onKeyDown} className="flex h-8 w-fit shrink-0 items-stretch rounded-lg bg-surface-subtle p-0.5">
      {options.map((option, i) => {
        const active = i === index;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            tabIndex={active || (index < 0 && i === 0) ? 0 : -1}
            onClick={() => onChange(String(option.value))}
            className={cn(
              "min-w-[64px] whitespace-nowrap rounded-md px-3 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/20 disabled:cursor-default",
              active ? "bg-raised font-semibold text-ink-1 shadow-card" : "font-medium text-ink-4",
              !active && !disabled && "hover:text-ink-2",
              disabled && !active && "text-ink-5",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

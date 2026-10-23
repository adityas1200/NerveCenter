import { Check, KeyRound } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { projectsApi, type ProjectApiKeyStatus } from "@/api/projects";
import { AGENT_DEFAULTS, AGENT_EFFORT_OPTIONS, AGENT_MODEL_OPTIONS, type AgentEffort, type AgentModel, type Operations } from "@/api/settings";
import { Badge, Button, Input, Skeleton, confirmAction, useToast } from "@/components/ui";
import { AGENT_NAME } from "@/components/ops/agentPanelContext";
import { useProject } from "@/lib/projectContext";
import { cn } from "@/lib/utils";
import { SaveFooter, SettingsSection } from "./SettingsShell";
import { isDirty, useSaveSection } from "./useSaveSection";

/**
 * Model: which Claude model Sonic runs on and how hard it thinks, saved to operations.yaml `agent`.
 * Every run reads it when it starts (backend/src/tasks/agent-model.mjs), so a change applies from
 * the next message. Haiku takes no effort level, so the effort control rests while it is selected.
 * Each choice is a family, not a version: Sonic always runs the newest model of it.
 */

type Draft = { model: AgentModel; effort: AgentEffort; budget: string };
const draftOf = (operations: Operations): Draft => ({
  model: AGENT_MODEL_OPTIONS.some((option) => option.value === operations.agent?.model) ? (operations.agent?.model as AgentModel) : AGENT_DEFAULTS.model,
  effort: AGENT_EFFORT_OPTIONS.some((option) => option.value === operations.agent?.effort) ? (operations.agent?.effort as AgentEffort) : AGENT_DEFAULTS.effort,
  budget: Number(operations.agent?.max_budget_usd) > 0 ? String(operations.agent?.max_budget_usd) : "",
});

export function ModelTab({ operations }: { operations: Operations }) {
  const save = useSaveSection();
  const [draft, setDraft] = useState<Draft>(() => draftOf(operations));
  useEffect(() => { setDraft(draftOf(operations)); }, [operations]);
  const model = AGENT_MODEL_OPTIONS.find((option) => option.value === draft.model) ?? AGENT_MODEL_OPTIONS.find((option) => option.value === AGENT_DEFAULTS.model)!;
  const effort = AGENT_EFFORT_OPTIONS.find((option) => option.value === draft.effort) ?? AGENT_EFFORT_OPTIONS[2];
  const budget = Number(draft.budget);
  const budgetInvalid = draft.budget.trim() !== "" && !(budget > 0);
  // Anything else in the block is passed through untouched; an empty limit removes it.
  const onSave = () => save.mutate({ section: "agent", value: { ...(operations.agent || {}), model: draft.model, effort: draft.effort, max_budget_usd: draft.budget.trim() ? budget : null } });
  return (
    <>
    <SettingsSection title="Model" footer={<SaveFooter pending={save.isPending} dirty={isDirty(draft, draftOf(operations))} disabled={budgetInvalid || !isDirty(draft, draftOf(operations))} onSave={onSave} />}>
      <p className="-mt-2 text-[13.5px] text-ink-4">Every task {AGENT_NAME} runs uses this. A change applies from the next message.</p>

      <div className="mt-5">
        <h3 className="text-[14px] font-medium text-ink-2">Model</h3>
        <RadioGroup label="Model" value={draft.model} onChange={(value) => setDraft((current) => ({ ...current, model: value }))} options={AGENT_MODEL_OPTIONS} className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
          renderOption={(option, selected) => (
            <>
              <span className="flex items-center justify-between gap-2">
                <span className="text-[14.5px] font-semibold text-ink-1">{option.label}</span>
                {option.value === AGENT_DEFAULTS.model ? <span className="rounded-full border border-line px-2 py-px text-[11.5px] font-medium text-ink-4">Default</span> : null}
                <Check className={cn("ml-auto h-4 w-4 shrink-0", selected ? "text-brand" : "text-transparent")} aria-hidden="true" />
              </span>
              <span className="mt-1 block text-[13px] leading-[18px] text-ink-4">{option.help}</span>
            </>
          )}
          optionClassName={(selected) => cn("flex flex-col rounded-xl border bg-raised p-3.5 text-left transition duration-200 ease-out", selected ? "border-brand shadow-card ring-1 ring-brand" : "border-line hover:border-line-strong")}
        />
      </div>

      <div className="mt-6">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-[14px] font-medium text-ink-2">Effort</h3>
          {draft.effort === AGENT_DEFAULTS.effort && model.effort ? <span className="text-[12.5px] text-ink-5">Default</span> : null}
        </div>
        <RadioGroup label="Effort" value={draft.effort} disabled={!model.effort} onChange={(value) => setDraft((current) => ({ ...current, effort: value }))} options={AGENT_EFFORT_OPTIONS}
          className="mt-2 grid w-full auto-cols-fr grid-flow-col rounded-xl border border-line bg-surface-subtle p-1"
          renderOption={(option) => option.label}
          optionClassName={(selected) => cn("flex h-9 min-w-0 items-center justify-center whitespace-nowrap rounded-lg px-3 text-[13.5px] transition-colors duration-200", selected ? "bg-raised font-semibold text-ink-1 shadow-card" : "font-medium text-ink-4 hover:text-ink-2", !model.effort && "cursor-default hover:text-ink-4")}
        />
        <p className="mt-1.5 min-h-[18px] text-[12.5px] leading-[18px] text-ink-4" data-testid="effort-help">{model.effort ? effort.help : `${model.label} runs without effort levels`}</p>
      </div>

      <div className="mt-6">
        <label htmlFor="agent-budget" className="text-[14px] font-medium text-ink-2">Spend limit per message</label>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[14px] text-ink-4">$</span>
          <input id="agent-budget" inputMode="decimal" placeholder="No limit" value={draft.budget} onChange={(event) => setDraft((current) => ({ ...current, budget: event.target.value }))}
            aria-invalid={budgetInvalid || undefined} aria-describedby="agent-budget-help"
            className={cn("h-9 w-32 rounded-lg border bg-raised px-3 text-[14px] tabular-nums text-ink-1 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand/25", budgetInvalid ? "border-red-500" : "border-line focus:border-line-strong")} />
        </div>
        <p id="agent-budget-help" className="mt-1.5 text-[12.5px] leading-[18px] text-ink-4">{budgetInvalid ? "Enter an amount in dollars, or leave it empty" : `${AGENT_NAME} stops a message's work when it reaches this amount. Leave empty for no limit.`}</p>
      </div>
    </SettingsSection>
    <ProjectApiKeySection />
    </>
  );
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong");
const shortDate = (value: string) => new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/**
 * SPEC-projects-04: the project's own Anthropic key, the only one its Claude calls use. Everyone in the project sees whether
 * one is set; app admins add, replace and remove it. The key is sent once and never comes back from the server.
 */
function ProjectApiKeySection() {
  const { projectId, isGlobalAdmin } = useProject();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [value, setValue] = useState("");
  const enabled = Boolean(projectId);
  const key = ["projects", "api-key", projectId];
  const status = useQuery({ queryKey: key, queryFn: ({ signal }) => projectsApi.apiKey(projectId as string, signal), enabled });
  const done = (next: ProjectApiKeyStatus) => { queryClient.setQueryData(key, next); setValue(""); };
  const save = useMutation({
    mutationFn: () => projectsApi.setApiKey(projectId as string, value.trim()),
    onSuccess: (next) => { done(next); toast.success("API key saved", next.verified ? undefined : "Anthropic could not be reached to check it."); },
  });
  const remove = useMutation({ mutationFn: () => projectsApi.removeApiKey(projectId as string), onSuccess: done, onError: (error) => toast.error("Not removed", errorText(error)) });
  if (!enabled) return null;
  const current = status.data;
  return (
    <SettingsSection title="API key" className="mt-4">
      <p className="-mt-2 text-[13.5px] text-ink-4">{AGENT_NAME} and data-quality mapping run on this project&apos;s own Anthropic key. Without one they do not run.</p>
      {status.isLoading ? <Skeleton className="mt-4 h-10 w-full" /> : null}
      {status.isError ? <p role="alert" className="mt-4 text-[13.5px] text-rose-700">{errorText(status.error)}</p> : null}
      {current ? (
        <div className="mt-4 flex items-center gap-3">
          <KeyRound className="h-4 w-4 shrink-0 text-ink-4" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-[14px] text-ink-1">{current.set ? <>Ends in <span className="font-mono text-[13px]">{current.last4}</span></> : "No key"}</p>
            {current.set && current.setAt ? <p className="text-[12.5px] text-ink-4">Added {current.setBy ? `by ${current.setBy} ` : ""}on {shortDate(current.setAt)}</p> : null}
          </div>
          <Badge variant={current.set ? "emerald" : "amber"}>{current.set ? "Set" : "Missing"}</Badge>
          {isGlobalAdmin && current.set ? (
            <Button variant="ghost" size="sm" disabled={remove.isPending} busy={remove.isPending} onClick={() => { void confirmAction({ title: "Remove this project's API key?", description: `${AGENT_NAME} stops running in this project until a new key is added.`, confirmLabel: "Remove", destructive: true }).then((ok) => { if (ok) remove.mutate(); }); }}>Remove</Button>
          ) : null}
        </div>
      ) : null}
      {current && isGlobalAdmin ? (
        <form className="mt-4" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
          <label htmlFor="project-api-key" className="mb-1.5 block text-[14px] font-medium text-ink-2">{current.set ? "Replace key" : "Add key"}</label>
          <div className="flex items-center gap-2">
            <Input id="project-api-key" type="password" value={value} onChange={(event) => setValue(event.target.value)} placeholder="sk-ant-…" autoComplete="off" spellCheck={false} className="min-w-0 flex-1 font-mono text-[13px]" />
            <Button type="submit" variant="primary" disabled={!value.trim() || save.isPending}>{save.isPending ? "Checking" : "Save key"}</Button>
          </div>
          <p className="mt-1.5 text-[13px] leading-4 text-ink-4">Checked with Anthropic before it is saved. It is stored encrypted and never shown again.</p>
          {save.isError ? <p role="alert" className="mt-2 text-[13px] text-rose-700">{errorText(save.error)}</p> : null}
        </form>
      ) : null}
      {current && !isGlobalAdmin ? <p className="mt-3 text-[13px] text-ink-4">Only an app admin can add or change it.</p> : null}
    </SettingsSection>
  );
}

/** A radio group with roving focus: arrow keys move the choice, Home and End jump to the ends. */
function RadioGroup<Value extends string, Option extends { value: Value; label: string }>({ label, value, onChange, options, disabled = false, className, optionClassName, renderOption }: {
  label: string;
  value: Value;
  onChange: (value: Value) => void;
  options: ReadonlyArray<Option>;
  disabled?: boolean;
  className?: string;
  optionClassName: (selected: boolean) => string;
  renderOption: (option: Option, selected: boolean) => ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const index = Math.max(0, options.findIndex((option) => option.value === value));
  const move = (to: number) => {
    if (disabled) return;
    const next = (to + options.length) % options.length;
    onChange(options[next].value);
    ref.current?.querySelectorAll<HTMLButtonElement>("[role=radio]")[next]?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const to = { ArrowRight: index + 1, ArrowDown: index + 1, ArrowLeft: index - 1, ArrowUp: index - 1, Home: 0, End: options.length - 1 }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    move(to);
  };
  return (
    <div ref={ref} role="radiogroup" aria-label={label} aria-disabled={disabled || undefined} tabIndex={-1} onKeyDown={onKeyDown} className={cn(className, disabled && "opacity-60")}>
      {options.map((option, i) => {
        const selected = i === index;
        return (
          <button key={option.value} type="button" role="radio" aria-checked={selected} disabled={disabled} tabIndex={selected ? 0 : -1} onClick={() => onChange(option.value)} className={cn(optionClassName(selected), "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/25")}>
            {renderOption(option, selected)}
          </button>
        );
      })}
    </div>
  );
}

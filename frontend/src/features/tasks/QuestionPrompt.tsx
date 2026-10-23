import { refreshAfterWrite } from "@/lib/refreshAfterWrite";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Minus } from "lucide-react";
import { useId, useMemo, useState, type ReactNode } from "react";
import { inboxApi, type QuestionAnswers, type QuestionSpec, inboxKeys } from "@/api/inbox";
import { AGENT_NAME } from "@/components/ops/agentPanelContext";
import { SurfaceCard } from "@/components/ops/SurfaceCard";
import { Button, Input, Textarea, useToast } from "@/components/ui";
import { cn } from "@/lib/utils";
import { answerSummary } from "./taskEvents";
import { taskKeys } from "@/api/tasks";

/**
 * The agent stopped to ask something. One card holds every question it asked (one to four), each with
 * its options as a radio list, or checkboxes when more than one answer fits, and an "Other" row for a
 * typed answer. One "Send answers" button posts all of them; "Skip" declines and the agent carries on
 * with its own judgement. Once settled, the card reads back what was chosen, like an approval does.
 * A `request_input` form (SPEC-tasks-10 FR-20) is the same card with typed fields instead of options;
 * only its required fields must be filled.
 */

export type QuestionSettled = { status: "answered"; answers: QuestionAnswers; by?: string | null } | { status: "denied"; by?: string | null };

const OTHER = "__other__";
interface Choice { picked: string[]; other: string; otherOn: boolean; value?: string }
const PICKED_FIELDS = new Set(["select", "multiselect", "boolean"]);
const typed = (question: QuestionSpec) => Boolean(question.field && !PICKED_FIELDS.has(question.field.type));
const isMulti = (question: QuestionSpec) => Boolean(question.multiSelect || question.field?.type === "multiselect");

function answerFor(question: QuestionSpec, choice: Choice | undefined): string {
  if (!choice) return "";
  if (typed(question)) return (choice.value || "").trim();
  if (question.field) return isMulti(question) ? choice.picked.join(", ") : choice.picked[0] || "";
  const other = choice.otherOn ? choice.other.trim() : "";
  if (question.multiSelect) return [...choice.picked, other].filter(Boolean).join(", ");
  return choice.otherOn ? other : choice.picked[0] || "";
}

export function QuestionPrompt({ inboxId, questions, title = null, reason = null, form = false, compact = false, className, settled, onSettled }: {
  inboxId: string;
  questions: QuestionSpec[];
  /** For a form: what it is for, and why Sonic needs it. */
  title?: string | null;
  reason?: string | null;
  form?: boolean;
  /** Tighter padding for the side panel. */
  compact?: boolean;
  className?: string;
  /** Render the read-back state straight away (from a `question.answered` event or an answered Inbox item). */
  settled?: QuestionSettled | null;
  onSettled?: (outcome: QuestionSettled) => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const groupId = useId();
  const [choices, setChoices] = useState<Record<number, Choice>>({});
  const [outcome, setOutcome] = useState<QuestionSettled | null>(null);
  // A form sends only what was filled in; a plain question sends every answer.
  const answers = useMemo<QuestionAnswers>(() => Object.fromEntries(questions.map((question, index) => [question.question, answerFor(question, choices[index])]).filter(([, value]) => !form || Boolean(value))), [questions, choices, form]);
  const missing = questions.filter((question) => (question.field ? question.field.required : true) && !answers[question.question]);
  const complete = questions.length > 0 && missing.length === 0;
  const refresh = async () => { await refreshAfterWrite(queryClient, { queryKey: inboxKeys.all }); await refreshAfterWrite(queryClient, { queryKey: taskKeys.all }); };
  const send = useMutation({
    mutationFn: () => inboxApi.answer(inboxId, answers),
    onSuccess: async () => { const result: QuestionSettled = { status: "answered", answers }; setOutcome(result); await refresh(); onSettled?.(result); },
    onError: (error) => toast.error("Answers not sent", error instanceof Error ? error.message : "Try again."),
  });
  const skip = useMutation({
    mutationFn: () => inboxApi.deny(inboxId),
    onError: (error) => toast.error("Not skipped", error instanceof Error ? error.message : "Try again."),
    onSuccess: async () => { const result: QuestionSettled = { status: "denied" }; setOutcome(result); await refresh(); onSettled?.(result); },
  });
  const done = settled || outcome;
  if (done) return <QuestionSettledCard questions={questions} settled={done} compact={compact} className={className} />;

  const update = (index: number, patch: Partial<Choice>) => setChoices((current) => ({ ...current, [index]: { picked: [], other: "", otherOn: false, ...current[index], ...patch } }));
  // A form's fields are labelled where they sit, so their headers would only repeat them.
  const headers = form ? [] : questions.map((question) => question.header?.trim()).filter((header): header is string => Boolean(header));
  const busy = send.isPending || skip.isPending;
  return (
    <SurfaceCard
      tone="warning"
      label={headers.length ? <span className="flex flex-wrap items-center gap-1.5">{headers.map((header, index) => <span key={`${header}-${index}`} className="rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5">{header}</span>)}</span> : form ? "Form" : "Question"}
      className={className}
      bodyClassName={cn("pt-1", compact && "px-3 pb-3")}
    >
      <p className="text-[13.5px] font-semibold text-ink-1">{form ? title || `${AGENT_NAME} needs a few details` : questions.length === 1 ? `${AGENT_NAME} has a question` : `${AGENT_NAME} has ${questions.length} questions`}</p>
      {form && reason ? <p className="mt-0.5 text-[13px] leading-5 text-ink-3">{reason}</p> : null}
      <div className={cn("mt-3 space-y-4", compact && "mt-2 space-y-3")}>
        {questions.map((question, index) => {
          const choice = choices[index] || { picked: [], other: "", otherOn: false };
          const multi = isMulti(question);
          const name = `${groupId}-${index}`;
          if (typed(question)) return <FieldInput key={name} id={name} question={question} value={choice.value || ""} onChange={(value) => update(index, { value })} disabled={busy} compact={compact} />;
          const isPicked = (label: string) => choice.picked.includes(label);
          const pick = (label: string) => update(index, multi ? { picked: isPicked(label) ? choice.picked.filter((item) => item !== label) : [...choice.picked, label] } : { picked: [label], otherOn: false });
          const pickOther = () => update(index, multi ? { otherOn: !choice.otherOn } : { otherOn: true, picked: [] });
          return (
            <fieldset key={name} className="min-w-0 border-0 p-0" disabled={busy}>
              <legend className="mb-1.5 text-[13.5px] leading-5 text-ink-1">{question.question}{multi ? <span className="ml-1.5 text-[12.5px] text-ink-5">Pick any</span> : null}{question.field && !question.field.required ? <span className="ml-1.5 text-[12.5px] text-ink-5">Optional</span> : null}</legend>
              <div className="space-y-1">
                {question.options.map((option) => (
                  <OptionRow key={option.label} checked={isPicked(option.label)} compact={compact}>
                    <input type={multi ? "checkbox" : "radio"} name={name} value={option.label} checked={isPicked(option.label)} onChange={() => pick(option.label)} className={cn("mt-1 h-3.5 w-3.5 shrink-0 accent-brand", multi && "rounded")} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] font-semibold leading-5 text-ink-1">{option.label}</span>
                      {option.description ? <span className="block text-[13px] leading-[18px] text-ink-4">{option.description}</span> : null}
                    </span>
                  </OptionRow>
                ))}
                {question.field ? null : <OptionRow checked={choice.otherOn} compact={compact}>
                  <input type={multi ? "checkbox" : "radio"} name={name} value={OTHER} checked={choice.otherOn} onChange={pickOther} aria-label="Other" className={cn("mt-1 h-3.5 w-3.5 shrink-0 accent-brand", multi && "rounded")} />
                  <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[13.5px] font-semibold leading-5 text-ink-1">Other</span>
                    <Input aria-label={`Other answer to: ${question.question}`} value={choice.other} placeholder="Type your answer" onChange={(event) => update(index, { other: event.target.value, otherOn: true, ...(multi ? {} : { picked: [] }) })} className="h-8 min-w-[160px] flex-1 border-line bg-raised text-[13.5px] shadow-none" />
                  </span>
                </OptionRow>}
              </div>
            </fieldset>
          );
        })}
      </div>
      <div className={cn("mt-3 flex flex-wrap items-center gap-2", compact && "mt-2.5")}>
        <Button size="sm" variant="primary" disabled={!complete || busy} onClick={() => send.mutate()}><Check className="h-3.5 w-3.5" />{send.isPending ? "Sending" : "Send answers"}</Button>
        <Button size="sm" variant="ghost" className="text-ink-3 hover:bg-surface-subtle" disabled={busy} onClick={() => skip.mutate()}>{skip.isPending ? "Skipping" : "Skip"}</Button>
        {!complete ? <span className="ml-auto text-[12.5px] text-ink-5">{form ? `Fill in ${missing.map((question) => question.question).join(", ")}` : questions.length === 1 ? "Pick an answer" : "Answer every question"}</span> : null}
      </div>
    </SurfaceCard>
  );
}

const INPUT_TYPE: Record<string, string> = { text: "text", email: "email", number: "number", date: "date" };

/** A typed form field: a line, a box, a number, a date or an email. */
function FieldInput({ id, question, value, onChange, disabled, compact }: { id: string; question: QuestionSpec; value: string; onChange: (value: string) => void; disabled: boolean; compact: boolean }) {
  const field = question.field!;
  const common = { id, value, disabled, placeholder: field.placeholder || undefined, "aria-required": field.required || undefined, onChange: (event: { target: { value: string } }) => onChange(event.target.value) };
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1.5 block text-[13.5px] leading-5 text-ink-1">{question.question}{!field.required ? <span className="ml-1.5 text-[12.5px] text-ink-5">Optional</span> : null}</label>
      {field.type === "textarea"
        ? <Textarea {...common} rows={compact ? 3 : 4} className="border-line bg-raised text-[13.5px] shadow-none" />
        : <Input {...common} type={INPUT_TYPE[field.type] || "text"} className="h-9 border-line bg-raised text-[13.5px] shadow-none" />}
    </div>
  );
}

function OptionRow({ checked, compact, children }: { checked: boolean; compact: boolean; children: ReactNode }) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 transition-colors duration-200", compact && "px-2.5 py-1.5", checked ? "border-line-strong bg-surface-subtle" : "border-line bg-raised hover:bg-surface-subtle")}>
      {children}
    </label>
  );
}

/** The read-back after a question is settled: "You answered: Last 7 days · Veltrix, Corvana", or that it was skipped. */
export function QuestionSettledCard({ questions, settled, compact = false, className }: { questions?: QuestionSpec[] | null; settled: QuestionSettled; compact?: boolean; className?: string }) {
  const answered = settled.status === "answered";
  const summary = answered ? answerSummary(settled.answers, questions) : "";
  const who = settled.by ? `${settled.by} answered` : "You answered";
  return (
    <div className={cn("flex items-start gap-2 rounded-xl border border-line bg-raised px-3 py-2.5 text-[13.5px]", compact && "px-2.5 py-2", className)} role="status">
      {answered ? <Check className="mt-1 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" /> : <Minus className="mt-1 h-3.5 w-3.5 shrink-0 text-ink-4" aria-hidden="true" />}
      <span className="min-w-0 text-ink-2">{answered ? <>{who}: <span className="font-medium text-ink-1">{summary || "—"}</span></> : "Skipped"}</span>
    </div>
  );
}

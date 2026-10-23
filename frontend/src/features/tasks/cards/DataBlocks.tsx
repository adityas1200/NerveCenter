import { AlertTriangle, Check, Clock, Minus, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { BarChart } from "@/components/ops/charts/BarChart";
import { DonutChart } from "@/components/ops/charts/DonutChart";
import { ChartLegend, ColumnChart, type ChartSeries } from "@/components/ops/charts/ColumnChart";
import { LineChart } from "@/components/ops/charts/LineChart";
import { seriesColor, sliceColor } from "@/features/boards/BoardWidgets";
import { cn } from "@/lib/utils";
import { AgentCard } from "./AgentCard";
import type { Block, CheckResult, FlowState, GridState, StepState, Tone } from "./blocks";
import { useTaskActions } from "./taskActions";

/**
 * The catalog's data components (SPEC-tasks-10 FR-13): chart, facts, status grid, progress, flow, set diff,
 * checklist, records, notes, and the plain card for a kind with no renderer yet. Each is a flat card in the
 * house frame; colour only on states, tones and numbers.
 */

type Of<K extends Block["kind"]> = Extract<Block, { kind: K }>;
type Props<K extends Block["kind"]> = { block: Of<K>; compact?: boolean; className?: string };

const TONE_TEXT: Record<Tone, string> = { neutral: "text-ink-1", good: "text-emerald-700", bad: "text-rose-700", warning: "text-amber-700" };

/** A small state word in its colour: Pass, Failed, Open. */
export function StateTag({ tone, children, className }: { tone: "good" | "bad" | "warning" | "neutral" | "brand"; children: ReactNode; className?: string }) {
  const style = { good: "bg-emerald-50 text-emerald-700 ring-emerald-200", bad: "bg-rose-50 text-rose-700 ring-rose-200", warning: "bg-amber-50 text-amber-800 ring-amber-200", neutral: "bg-surface-subtle text-ink-3 ring-line", brand: "bg-brand-soft text-brand ring-brand/20" }[tone];
  return <span className={cn("inline-flex shrink-0 items-center whitespace-nowrap rounded-md px-1.5 py-px text-[11.5px] font-semibold ring-1", style, className)}>{children}</span>;
}

/* ------------------------------------------------------------------ chart */

export function ChartBlock({ block, compact = false, className }: Props<"chart">) {
  const series: ChartSeries[] = block.series.map((item, index) => ({ key: `${item.name}-${index}`, name: item.name, color: seriesColor(item.name, index), values: item.values }));
  const height = compact ? 130 : 170;
  const ariaLabel = `${block.title}: ${block.series.map((item) => item.name).join(", ")}${block.unit ? ` in ${block.unit}` : ""}`;
  return (
    <AgentCard title={block.title} note={block.unit} compact={compact} className={className}>
      {series.length > 1 && block.type !== "donut" ? <ChartLegend series={series} className="mb-1" /> : null}
      {block.type === "donut" ? <DonutChart labels={block.labels} series={series.slice(0, 1)} colors={block.labels.map((label, index) => sliceColor(label, index))} height={compact ? 150 : 190} ariaLabel={ariaLabel} showValues />
        : block.type === "bar" ? <BarChart labels={block.labels} series={series} height={Math.max(height, block.labels.length * 24)} ariaLabel={ariaLabel} showValues />
        : block.type === "line" || block.type === "area" ? <LineChart labels={block.labels} series={series} height={height} ariaLabel={ariaLabel} variant={block.type} />
          : <ColumnChart labels={block.labels} series={series} height={height} ariaLabel={ariaLabel} layout={block.layout} />}
      {block.note ? <p className="mt-2 text-[12.5px] text-ink-4">{block.note}</p> : null}
    </AgentCard>
  );
}

/* ------------------------------------------------------------------ facts */

export function FactsBlock({ block, compact = false, className }: Props<"facts">) {
  return (
    <AgentCard title={block.title} compact={compact} className={className}>
      <dl className="grid gap-x-6 gap-y-2 text-[13.5px]" style={{ gridTemplateColumns: compact ? "minmax(0, 1fr)" : "repeat(auto-fill, minmax(260px, 1fr))" }}>
        {block.items.map((item, index) => <div key={`${item.label}-${index}`} className="flex min-w-0 items-baseline justify-between gap-3 border-b border-line-soft pb-1.5 last:border-0"><dt className="shrink-0 text-ink-4">{item.label}</dt><dd className={cn("min-w-0 truncate text-right font-medium tabular-nums", TONE_TEXT[item.tone])} title={item.value}>{item.value}</dd></div>)}
      </dl>
      {block.note ? <p className="mt-2 text-[12.5px] text-ink-4">{block.note}</p> : null}
    </AgentCard>
  );
}

/* ------------------------------------------------------------ status grid */

const CELL: Record<GridState, string> = {
  ok: "bg-emerald-500/25",
  failed: "bg-rose-500",
  warning: "bg-amber-400",
  running: "bg-brand/50",
  skipped: "bg-surface-subtle ring-1 ring-inset ring-line",
  none: "border border-dashed border-line-strong",
};
const CELL_WORD: Record<GridState, string> = { ok: "OK", failed: "Failed", warning: "Warning", running: "Running", skipped: "Skipped", none: "No run" };

export function StatusGridBlock({ block, compact = false, className }: Props<"status_grid">) {
  const actions = useTaskActions();
  const [hover, setHover] = useState<string | null>(null);
  const template = { gridTemplateColumns: `repeat(${block.columns.length}, minmax(0, 1fr))` };
  return (
    <AgentCard title={block.title} compact={compact} className={className}>
      <div className="space-y-2.5" role="table" aria-label={block.title}>
        {block.rows.map((row, rowIndex) => (
          <div key={`${row.label}-${rowIndex}`} role="row" className={cn("grid items-center gap-3", compact ? "grid-cols-[96px_1fr]" : "grid-cols-[150px_1fr]")}>
            <div role="rowheader" className="min-w-0"><p className="truncate text-[13px] font-medium text-ink-1" title={row.label}>{row.label}</p>{row.sub ? <p className="truncate text-[12px] text-ink-4" title={row.sub}>{row.sub}</p> : null}</div>
            <div className="grid gap-1.5" style={template}>
              {block.columns.map((column, index) => {
                const cell = row.cells[index] ?? { state: "none" as GridState, label: null, ask: null };
                const label = cell.label || `${row.label} · ${column || `#${index + 1}`} · ${CELL_WORD[cell.state]}`;
                const clickable = Boolean(cell.ask && actions.ask && actions.canAsk);
                const common = cn("h-7 rounded-md transition-shadow", CELL[cell.state], (clickable || cell.label) && "hover:ring-2 hover:ring-ink-1/15");
                return clickable
                  ? <span key={index} role="cell" className="flex"><button type="button" aria-label={label} title={label} className={cn(common, "w-full")} onMouseEnter={() => setHover(label)} onFocus={() => setHover(label)} onClick={() => actions.ask?.(cell.ask || "")} /></span>
                  : <span key={index} role="cell" aria-label={label} title={label} className={common} onMouseEnter={() => setHover(label)} />;
              })}
            </div>
          </div>
        ))}
        <div className={cn("grid gap-3", compact ? "grid-cols-[96px_1fr]" : "grid-cols-[150px_1fr]")} aria-hidden="true">
          <span />
          <div className="grid gap-1.5" style={template}>{block.columns.map((column, index) => <span key={index} className="truncate text-center text-[11.5px] text-ink-4">{column}</span>)}</div>
        </div>
      </div>
      <p className="mt-2 min-h-[18px] text-[12.5px] text-ink-3" aria-live="polite">{hover || block.note || ""}</p>
    </AgentCard>
  );
}

/* --------------------------------------------------------------- progress */

const STEP_BAR: Record<StepState, string> = { done: "bg-emerald-500/70", running: "bg-brand", failed: "bg-rose-500", pending: "bg-line", skipped: "bg-line" };
const STEP_WORD: Record<StepState, string> = { done: "", running: "Running", failed: "Failed", pending: "Waiting", skipped: "Skipped" };
const seconds = (value: number) => (value < 60 ? `${Math.round(value)}s` : value < 3600 ? `${Math.floor(value / 60)}m ${String(Math.round(value % 60)).padStart(2, "0")}s` : `${Math.floor(value / 3600)}h ${String(Math.floor((value % 3600) / 60)).padStart(2, "0")}m`);

export function ProgressBlock({ block, compact = false, className }: Props<"progress">) {
  const total = block.steps.reduce((sum, step) => sum + (step.seconds ?? 0), 0);
  let offset = 0;
  return (
    <AgentCard title={block.title} compact={compact} className={className} action={<StateTag tone={block.state === "failed" ? "bad" : block.state === "running" ? "brand" : "good"}>{block.state === "failed" ? "Failed" : block.state === "running" ? "Running" : "Done"}</StateTag>}>
      <ol className="space-y-2.5">
        {block.steps.map((step, index) => {
          const share = total > 0 && step.seconds ? (step.seconds / total) * 100 : step.state === "running" ? 12 : 0;
          const left = total > 0 ? (offset / total) * 100 : 0;
          offset += step.seconds ?? 0;
          return (
            <li key={`${step.label}-${index}`} className={cn("grid items-center gap-3 text-[13px]", compact ? "grid-cols-[110px_1fr_56px]" : "grid-cols-[170px_1fr_70px]")}>
              <span className="truncate font-mono text-[12px] text-ink-2" title={step.note || step.label}>{step.label}</span>
              <span className="relative h-2 overflow-hidden rounded-full bg-surface-subtle"><span className={cn("absolute inset-y-0 rounded-full transition-[width] duration-500 ease-out", STEP_BAR[step.state])} style={{ left: `${Math.min(left, 100)}%`, width: `${Math.max(share, step.state === "done" || step.state === "failed" ? 2 : 0)}%` }} /></span>
              <span className="text-right text-[12px] tabular-nums text-ink-4">{step.seconds !== null ? seconds(step.seconds) : STEP_WORD[step.state]}</span>
            </li>
          );
        })}
      </ol>
      {block.note ? <p className="mt-2 text-[12.5px] text-ink-4">{block.note}</p> : null}
    </AgentCard>
  );
}

/* ------------------------------------------------------------------- flow */

const FLOW_DOT: Record<FlowState, string> = {
  done: "border-emerald-500 text-emerald-600 bg-raised",
  failed: "border-rose-500 bg-rose-500 text-white",
  stale: "border-amber-500 text-amber-600 bg-raised",
  warning: "border-amber-500 text-amber-600 bg-raised",
  running: "border-brand text-brand bg-raised",
  pending: "border-line-strong text-ink-5 bg-raised",
  skipped: "border-line-strong text-ink-5 bg-surface-subtle",
};
const FLOW_SUB: Partial<Record<FlowState, string>> = { failed: "text-rose-700", stale: "text-amber-700", warning: "text-amber-700" };

function FlowMark({ state }: { state: FlowState }) {
  if (state === "done") return <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />;
  if (state === "failed") return <X className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />;
  if (state === "stale" || state === "warning") return <AlertTriangle className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />;
  if (state === "running") return <span className="h-2 w-2 animate-pulse rounded-full bg-brand" aria-hidden="true" />;
  if (state === "skipped") return <Minus className="h-3 w-3" aria-hidden="true" />;
  return <Clock className="h-3 w-3" aria-hidden="true" />;
}

export function FlowBlock({ block, compact = false, className }: Props<"flow">) {
  return (
    <AgentCard title={block.title} compact={compact} className={className}>
      <ol className="flex items-start overflow-x-auto pb-1" aria-label={block.title}>
        {block.steps.map((step, index) => (
          <li key={`${step.label}-${index}`} className={cn("relative flex flex-1 flex-col items-center gap-1.5 px-1 text-center", compact ? "min-w-[64px]" : "min-w-[84px]")} aria-label={`${step.label}: ${step.state}${step.sub ? `, ${step.sub}` : ""}`}>
            {index < block.steps.length - 1 ? <span className={cn("absolute left-1/2 top-[13px] h-0.5 w-full", step.state === "done" ? "bg-emerald-500/50" : "bg-line")} aria-hidden="true" /> : null}
            <span className={cn("relative z-10 flex h-7 w-7 items-center justify-center rounded-full border-2", FLOW_DOT[step.state])}><FlowMark state={step.state} /></span>
            <span className="text-[12.5px] font-semibold leading-4 text-ink-1">{step.label}</span>
            {step.sub ? <span className={cn("-mt-1 text-[11.5px] leading-4 text-ink-4", FLOW_SUB[step.state])}>{step.sub}</span> : null}
          </li>
        ))}
      </ol>
      {block.note ? <p className="mt-2 text-[12.5px] text-ink-4">{block.note}</p> : null}
    </AgentCard>
  );
}

/* --------------------------------------------------------------- set diff */

export function SetDiffBlock({ block, compact = false, className }: Props<"set_diff">) {
  const left = new Set(block.left); const right = new Set(block.right);
  const added = block.right.filter((item) => !left.has(item));
  const missing = block.left.filter((item) => !right.has(item));
  const summary = [added.length ? `${added.length} added` : null, missing.length ? `${missing.length} missing` : null].filter(Boolean).join(" · ") || "Same items";
  const row = (label: string, items: string[], other: Set<string>, mark: "added" | "missing") => (
    <div className={cn("grid items-start gap-3", compact ? "grid-cols-1" : "grid-cols-[112px_1fr]")}>
      <span className="pt-1 text-[12.5px] text-ink-4">{label} <span className="tabular-nums text-ink-5">{items.length}</span></span>
      <ol className="flex flex-wrap gap-1">
        {items.map((item, index) => {
          const only = !other.has(item);
          return <li key={`${item}-${index}`} className={cn("rounded-md border px-1.5 py-0.5 font-mono text-[11.5px]", only ? mark === "added" ? "border-emerald-300 bg-emerald-50 font-semibold text-emerald-800" : "border-rose-300 bg-rose-50 font-semibold text-rose-800 line-through decoration-rose-400" : "border-line-soft bg-surface-subtle text-ink-3")} title={`${index + 1}. ${item}${only ? (mark === "added" ? " (only here)" : " (missing on the other side)") : ""}`}><span className="mr-1 text-ink-5">{index + 1}</span>{item}</li>;
        })}
      </ol>
    </div>
  );
  return (
    <AgentCard title={block.title} note={summary} compact={compact} className={className}>
      <div className="space-y-2.5">
        {row(block.leftLabel, block.left, right, "missing")}
        {row(block.rightLabel, block.right, left, "added")}
      </div>
      {block.note ? <p className="mt-2.5 text-[12.5px] leading-5 text-ink-3">{block.note}</p> : null}
    </AgentCard>
  );
}

/* -------------------------------------------------------------- checklist */

const RESULT: Record<CheckResult, { tone: "good" | "bad" | "warning" | "neutral"; word: string }> = { pass: { tone: "good", word: "Pass" }, fail: { tone: "bad", word: "Fail" }, open: { tone: "warning", word: "Open" }, skipped: { tone: "neutral", word: "Skipped" }, info: { tone: "neutral", word: "Info" } };

export function ChecklistBlock({ block, compact = false, className }: Props<"checklist">) {
  const actions = useTaskActions();
  const passed = block.items.filter((item) => item.result === "pass").length;
  const open = block.items.filter((item) => item.result === "open").length;
  const failed = block.items.filter((item) => item.result === "fail").length;
  const note = [`${passed} of ${block.items.length} pass`, failed ? `${failed} failed` : null, open ? `${open} open` : null].filter(Boolean).join(" · ");
  return (
    <AgentCard title={block.title} note={note} compact={compact} className={className} bodyClassName="px-0 pb-0">
      <ul className="divide-y divide-line-soft border-t border-line-soft">
        {block.items.map((item, index) => (
          <li key={`${item.label}-${index}`} className={cn("flex items-start gap-3 px-4 py-2.5", compact && "px-3 py-2")}>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-medium text-ink-1">{item.label}</p>
              {item.evidence ? <p className="mt-0.5 text-[13px] leading-5 text-ink-3">{item.evidence}</p> : null}
              {item.ask && actions.ask ? <button type="button" disabled={!actions.canAsk} title={actions.canAsk ? item.ask : actions.askBlocked} onClick={() => actions.ask?.(item.ask || "")} className="mt-1.5 rounded-md border border-line bg-raised px-2 py-0.5 text-[12.5px] font-medium text-ink-2 transition-colors hover:border-line-strong hover:text-ink-1 disabled:opacity-50">{item.result === "open" ? "Settle this" : "Ask about this"}</button> : null}
            </div>
            <StateTag tone={RESULT[item.result].tone}>{RESULT[item.result].word}</StateTag>
          </li>
        ))}
      </ul>
      {block.note ? <p className="border-t border-line-soft px-4 py-2 text-[12.5px] text-ink-4">{block.note}</p> : null}
    </AgentCard>
  );
}

/* ---------------------------------------------------------------- records */

const DONE_STATE = /^(resolved|done|closed|merged|complete[d]?|success|fixed)$/i;

export function RecordsBlock({ block, compact = false, className }: Props<"records">) {
  return (
    <AgentCard title={block.title} compact={compact} className={className} bodyClassName="px-0 pb-0">
      <ul className="divide-y divide-line-soft border-t border-line-soft">
        {block.items.map((item, index) => (
          <li key={`${item.id}-${index}`} className={cn("grid items-center gap-x-3 gap-y-1 px-4 py-2.5 text-[13px]", compact ? "grid-cols-1 px-3" : "grid-cols-[130px_1fr_auto]")}>
            <div className="min-w-0">{item.url ? <a href={item.url} target={item.url.startsWith("/") ? undefined : "_blank"} rel="noreferrer" className="font-semibold text-ink-1 hover:text-brand">{item.id}</a> : <span className="font-semibold text-ink-1">{item.id}</span>}<p className="truncate text-[12px] text-ink-4">{item.system}</p></div>
            <div className="min-w-0">
              <span className="flex flex-wrap items-center gap-1.5">{item.from ? <><StateTag tone="neutral">{item.from}</StateTag><span className="text-ink-5" aria-label="to">→</span></> : null}<StateTag tone={DONE_STATE.test(item.to) ? "good" : "brand"}>{item.to}</StateTag></span>
              {item.title || item.note ? <p className="mt-1 text-[12.5px] leading-5 text-ink-4">{[item.title, item.note].filter(Boolean).join(" · ")}</p> : null}
            </div>
            {item.verified ? <span className="flex items-center gap-1 text-[12px] font-medium text-emerald-700"><Check className="h-3.5 w-3.5" aria-hidden="true" />Read back</span> : <span className="text-[12px] text-ink-5">Not read back</span>}
          </li>
        ))}
      </ul>
    </AgentCard>
  );
}

/* ------------------------------------------------------------------ notes */

const NOTE_DOT: Record<Tone, string> = { neutral: "bg-ink-5", good: "bg-emerald-500", bad: "bg-rose-500", warning: "bg-amber-500" };

/** A run-in title needs its full stop, or it reads as the first words of the sentence after it. */
const runIn = (title: string, followed: boolean) => (followed && !/[.!?:]$/.test(title.trim()) ? `${title.trim()}.` : title);

export function NotesBlock({ block, compact = false, className }: Props<"notes">) {
  return (
    <section className={cn("min-w-0", className)} aria-label={block.title || "Notes"}>
      {block.title ? <h3 className="mb-2 text-[12.5px] font-medium text-ink-4">{block.title}</h3> : null}
      <ul className="space-y-2.5">
        {block.items.map((item, index) => (
          <li key={`${item.title}-${index}`} className={cn("grid grid-cols-[6px_1fr] gap-3 leading-6 text-ink-2", compact ? "text-[13.5px]" : "text-[14px]")}>
            <span className={cn("mt-[9px] h-1.5 w-1.5 rounded-full", NOTE_DOT[item.tone])} aria-hidden="true" />
            <span>{item.title ? <b className="font-semibold text-ink-1">{runIn(item.title, Boolean(item.text))}</b> : null}{item.title && item.text ? " " : null}{item.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------------------------------------------------------------- generic */

/** A component the page has no renderer for yet: its fields, readable. */
export function GenericBlockCard({ block, compact = false, className }: Props<"generic">) {
  return (
    <AgentCard title={block.title} compact={compact} className={className}>
      {block.fields.length ? <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">{block.fields.map(([label, value]) => <div key={label} className="contents"><dt className="text-ink-4">{label}</dt><dd className="min-w-0 break-words text-ink-2">{value}</dd></div>)}</dl> : null}
      {block.tables.map((table) => (
        <div key={table.title} className={cn("min-w-0", block.fields.length && "mt-3")}>
          <p className="mb-1 text-[12px] font-medium text-ink-4">{table.title}</p>
          <div className="overflow-x-auto rounded-lg border border-line-soft">
            <table className="w-full text-[12.5px]">
              <thead className="bg-surface-subtle text-left text-ink-4"><tr>{table.columns.map((column) => <th key={column} scope="col" className="whitespace-nowrap px-2.5 py-1.5 font-medium">{column}</th>)}</tr></thead>
              <tbody className="divide-y divide-line-soft">{table.rows.map((row, index) => <tr key={index}>{row.map((cell, column) => <td key={column} className="max-w-[240px] truncate px-2.5 py-1.5 text-ink-2" title={cell}>{cell}</td>)}</tr>)}</tbody>
            </table>
          </div>
          {table.more ? <p className="mt-1 text-[12px] text-ink-5">{table.more} more not shown</p> : null}
        </div>
      ))}
      {!block.fields.length && !block.tables.length ? <p className="text-[13px] text-ink-4">Nothing to show</p> : null}
    </AgentCard>
  );
}

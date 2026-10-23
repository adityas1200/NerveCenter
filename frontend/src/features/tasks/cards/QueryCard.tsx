import { Database } from "lucide-react";
import { cn } from "@/lib/utils";
import { AgentCard } from "./AgentCard";
import { isNumeric, type Card, type CellValue } from "./cards";

/**
 * One query Sonic ran: what it checked, the tables it read, the SQL (folded), and the first rows that
 * came back, so a reader can see the evidence behind a finding without opening a notebook.
 */
export function QueryCard({ card, compact = false, className, rowsShown = 8 }: { card: Extract<Card, { kind: "query" }>; compact?: boolean; className?: string; rowsShown?: number }) {
  const result = card.result;
  const note = result?.error ? "Failed" : result ? [`${result.rowCount.toLocaleString()} ${result.rowCount === 1 ? "row" : "rows"}`, result.durationMs !== null ? `${result.durationMs.toLocaleString()} ms` : null, card.provider].filter(Boolean).join(" · ") : card.provider;
  const columns = result?.columns.slice(0, 6) ?? [];
  return (
    <AgentCard title={card.title} note={note} compact={compact} className={className}>
      {card.tables.length ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Tables read">
          {card.tables.map((table) => <li key={table} className="inline-flex max-w-full items-center gap-1 rounded-md border border-line bg-surface-subtle px-1.5 py-0.5 font-mono text-[12px] text-ink-2"><Database className="h-3 w-3 shrink-0 text-ink-5" aria-hidden="true" /><span className="truncate">{table}</span></li>)}
        </ul>
      ) : null}
      <details className="group mt-2">
        <summary className="cursor-pointer select-none text-[12.5px] font-medium text-ink-4 hover:text-ink-2">SQL</summary>
        <pre className="mt-1.5 max-h-56 overflow-auto rounded-lg border border-line bg-surface-subtle p-2.5 font-mono text-[12px] leading-[18px] text-ink-2">{card.statement}</pre>
      </details>
      {result?.error ? <p className="mt-2 text-[13px] text-rose-700">{result.error}</p> : null}
      {result && !result.error && columns.length ? (
        <div className="mt-2 overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-[12.5px]">
            <thead><tr className="bg-surface-subtle text-left text-ink-4">{columns.map((column) => <th key={column} scope="col" className="whitespace-nowrap px-2.5 py-1.5 font-medium">{column}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">
              {result.rows.slice(0, rowsShown).map((row, index) => (
                <tr key={index}>{columns.map((column, cellIndex) => <td key={column} className={cn("max-w-[220px] truncate px-2.5 py-1.5 text-ink-2", isNumeric(row[cellIndex]) && "text-right font-mono tabular-nums")}><Value value={row[cellIndex]} /></td>)}</tr>
              ))}
            </tbody>
          </table>
          {result.rowCount > rowsShown ? <p className="border-t border-line px-2.5 py-1.5 text-[12px] text-ink-4">{Math.min(rowsShown, result.rows.length)} of {result.rowCount.toLocaleString()} rows</p> : null}
        </div>
      ) : null}
      {result && !result.error && !columns.length ? <p className="mt-2 text-[13px] text-ink-4">No rows came back</p> : null}
    </AgentCard>
  );
}

function Value({ value }: { value: CellValue }) {
  if (value === null || value === "") return <span className="text-ink-5">—</span>;
  return <>{typeof value === "number" ? value.toLocaleString() : value}</>;
}

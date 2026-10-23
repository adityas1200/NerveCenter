import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { OperationalStatus } from "@/components/ops/OperationalStatus";
import { cn } from "@/lib/utils";
import { AgentCard } from "./AgentCard";
import { isNumeric, isTicketId, type Card, type CellValue } from "./cards";

/**
 * A small table the agent asked to show. A column named Status is drawn with the shared status
 * pills, numbers are right-aligned, ticket ids open the ticket, and long tables fold after 8 rows.
 * The compact form (agent panel) keeps 4 columns and 5 rows and points at the full task.
 */

const FULL_ROWS = 8;
const COMPACT_ROWS = 5;
const COMPACT_COLUMNS = 4;

export function TableCard({ card, compact = false, taskId, className }: { card: Extract<Card, { kind: "table" }>; compact?: boolean; taskId?: string; className?: string }) {
  const [showAll, setShowAll] = useState(false);
  const columns = compact ? card.columns.slice(0, COMPACT_COLUMNS) : card.columns;
  const limit = compact ? COMPACT_ROWS : FULL_ROWS;
  const numeric = useMemo(() => columns.map((_column, index) => card.rows.length > 0 && card.rows.every((row) => row[index] === null || row[index] === undefined || isNumeric(row[index]))), [columns, card.rows]);
  const statusColumn = useMemo(() => columns.map((column) => column.trim().toLowerCase() === "status"), [columns]);
  // Fixed layout splits columns evenly, which squeezes a sentence column and breaks short ids mid-word;
  // each column gets a share by how long its cells run (the longest third, capped), so text has room.
  const widths = useMemo(() => {
    const weights = columns.map((column, index) => {
      const lengths = card.rows.map((row) => String(row[index] ?? "").length).sort((a, b) => a - b);
      const typical = lengths.length ? lengths[Math.floor(lengths.length * 0.67)] : 0;
      return Math.min(48, Math.max(8, column.length + 2, statusColumn[index] ? 15 : typical));
    });
    const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
    return weights.map((weight) => `${((weight / total) * 100).toFixed(2)}%`);
  }, [columns, card.rows, statusColumn]);
  const rows = showAll && !compact ? card.rows : card.rows.slice(0, limit);
  const hidden = card.rows.length - rows.length;
  const moreColumns = card.columns.length - columns.length;
  const action = compact && taskId ? <Link to={`/tasks/${encodeURIComponent(taskId)}`} className="font-medium text-ink-4 hover:text-ink-1">Open task</Link> : undefined;
  return (
    <AgentCard title={card.title} note={card.note} action={action} compact={compact} className={className} bodyClassName="px-0 py-0">
      <div className="overflow-x-auto">
        {/* table-fixed + overflow-hidden on cells: a <td> with the default overflow:visible refuses to
            shrink below its longest unbreakable word (the CSS "automatic minimum size" rule), so a long
            Finding/Title cell forces the row wider than the panel even with overflow-x-auto on the wrapper
            and w-full on the table. overflow-hidden zeroes that minimum out so cells actually wrap. */}
        <table className="w-full table-fixed text-[13.5px]">
          {/* A status column is as wide as its longest pill, whatever the other columns hold. */}
          <colgroup>{widths.map((width, index) => <col key={index} style={{ width: statusColumn[index] ? 116 : width }} />)}</colgroup>
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-[0.05em] text-ink-5">
              {columns.map((column, index) => <th key={`${column}-${index}`} scope="col" className={cn("overflow-hidden break-words px-3 py-2 font-semibold", compact && "px-2.5", numeric[index] && "text-right")}>{column}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-line border-t border-line">
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="align-top">
                {columns.map((_column, index) => <td key={index} className={cn("overflow-hidden break-words px-3 py-2 text-ink-2", compact && "px-2.5 py-1.5", numeric[index] && "text-right font-mono tabular-nums")}>{statusColumn[index] ? <Cell value={row[index]} status /> : <Cell value={row[index]} />}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hidden > 0 || moreColumns > 0 ? (
        <div className={cn("flex items-center justify-between gap-3 border-t border-line px-3 py-1.5 text-[12.5px] text-ink-5", compact && "px-2.5")}>
          <span>{[hidden > 0 ? `${hidden} more ${hidden === 1 ? "row" : "rows"}` : null, moreColumns > 0 ? `${moreColumns} more ${moreColumns === 1 ? "column" : "columns"}` : null].filter(Boolean).join(" · ")}</span>
          {!compact && hidden > 0 ? <button type="button" className="font-medium text-ink-4 hover:text-ink-1" onClick={() => setShowAll(true)}>Show all {card.rows.length}</button> : null}
        </div>
      ) : null}
    </AgentCard>
  );
}

function Cell({ value, status = false }: { value: CellValue | undefined; status?: boolean }) {
  if (value === null || value === undefined || value === "") return <span className="text-ink-5">—</span>;
  if (status) return <OperationalStatus value={value} />;
  if (isTicketId(value)) return <Link to={`/tickets/${encodeURIComponent(value.trim())}`} className="font-medium text-ink-1 underline decoration-line-strong underline-offset-2 hover:decoration-ink-3">{value.trim()}</Link>;
  return <>{typeof value === "number" ? value.toLocaleString() : value}</>;
}

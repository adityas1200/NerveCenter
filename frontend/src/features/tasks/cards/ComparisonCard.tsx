import { cn } from "@/lib/utils";
import { AgentCard } from "./AgentCard";
import { isNumeric, type Card, type CellValue } from "./cards";

/** Before and after in two value columns; a changed row tints only its after cell. */
export function ComparisonCard({ card, compact = false, className }: { card: Extract<Card, { kind: "comparison" }>; compact?: boolean; className?: string }) {
  const changed = card.rows.filter((row) => row.changed).length;
  return (
    <AgentCard title={card.title} note={changed ? `${changed} of ${card.rows.length} changed` : "No differences"} compact={compact} className={className} bodyClassName="px-0 py-0">
      <table className="w-full text-[13.5px]">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-[0.05em] text-ink-5">
            <th scope="col" className={cn("px-3 py-2 font-semibold", compact && "px-2.5")}><span className="sr-only">Item</span></th>
            <th scope="col" className={cn("px-3 py-2 text-right font-semibold", compact && "px-2.5")}>{card.beforeLabel}</th>
            <th scope="col" className={cn("px-3 py-2 text-right font-semibold", compact && "px-2.5")}>{card.afterLabel}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line border-t border-line">
          {card.rows.map((row, index) => (
            <tr key={`${row.label}-${index}`}>
              <th scope="row" className={cn("px-3 py-2 text-left font-medium text-ink-2", compact && "px-2.5 py-1.5")}>{row.label}</th>
              <td className={cn("px-3 py-2 text-right text-ink-3", compact && "px-2.5 py-1.5", isNumeric(row.before) && "font-mono tabular-nums")}><Value value={row.before} /></td>
              <td className={cn("px-3 py-2 text-right text-ink-1", compact && "px-2.5 py-1.5", isNumeric(row.after) && "font-mono tabular-nums", row.changed && "bg-amber-50 font-medium text-amber-900")}><Value value={row.after} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </AgentCard>
  );
}

function Value({ value }: { value: CellValue }) {
  if (value === null || value === "") return <span className="text-ink-5">—</span>;
  return <>{typeof value === "number" ? value.toLocaleString() : value}</>;
}

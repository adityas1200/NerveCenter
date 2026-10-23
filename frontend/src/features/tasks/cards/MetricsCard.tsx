import { StatCell, type StatTone } from "@/components/ops/StatStrip";
import { cn } from "@/lib/utils";
import type { Card, CardTone } from "./cards";

/** One to four headline numbers as the app's own stat tiles. Colour only on a toned, non-zero figure. */

/** "+12%", "-3 runs", "0.4 h": a delta reads as a chip; anything wordier reads as a plain note. */
const isDelta = (text?: string | null) => Boolean(text) && String(text).length <= 14 && /^[+\-−±]\d|^\d[\d.,]*\s?%$/.test(String(text));

const TONE: Record<CardTone, StatTone> = { neutral: "slate", good: "emerald", bad: "rose", warning: "amber" };

export function MetricsCard({ card, compact = false, className }: { card: Extract<Card, { kind: "metrics" }>; compact?: boolean; className?: string }) {
  const count = card.items.length;
  const columns = compact ? (count === 1 ? "grid-cols-1" : "grid-cols-2") : count === 1 ? "grid-cols-1" : count === 2 ? "grid-cols-2" : count === 3 ? "grid-cols-3" : "grid-cols-2 xl:grid-cols-4";
  return (
    <div className={cn("grid gap-3", columns, className)} role="group" aria-label="Key numbers">
      {card.items.map((item, index) => (
        <StatCell key={`${item.label}-${index}`} label={item.label} value={item.value} suffix={item.suffix || undefined} support={isDelta(item.delta) ? item.delta || undefined : undefined} note={item.delta && !isDelta(item.delta) ? item.delta : undefined} trend={item.trend} tone={TONE[item.tone]} className={compact ? "px-3 pb-2.5 pt-3 [&_.font-display]:text-[22px]" : undefined} />
      ))}
    </div>
  );
}

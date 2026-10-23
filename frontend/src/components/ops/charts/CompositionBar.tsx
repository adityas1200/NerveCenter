import { cn } from "@/lib/utils";

/**
 * One horizontal bar split into parts, for "how did the checks go": passed,
 * warning, failed. Parts are separated by a 2px surface gap and named in a
 * legend with their counts, so colour never carries the meaning alone.
 */

export interface CompositionSegment {
  key: string;
  name: string;
  value: number;
  color: string;
}

export function CompositionBar({ segments, ariaLabel, className }: { segments: CompositionSegment[]; ariaLabel: string; className?: string }) {
  const total = segments.reduce((sum, item) => sum + Math.max(0, item.value), 0);
  const visible = segments.filter((item) => item.value > 0);
  return (
    <div className={cn("space-y-2", className)}>
      <div role="img" aria-label={ariaLabel} className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-surface-subtle">
        {visible.map((item, index) => (
          <span
            key={item.key}
            className={cn("chart-bar-part block h-full", index === 0 && "rounded-l-full", index === visible.length - 1 && "rounded-r-full")}
            style={{ width: `${(item.value / (total || 1)) * 100}%`, background: item.color, animationDelay: `${index * 60}ms` }}
          />
        ))}
      </div>
      <ul className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[12.5px] text-ink-3">
        {segments.map((item) => (
          <li key={item.key} className="flex items-center gap-1.5">
            <i className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: item.color }} aria-hidden="true" />
            <span className="tabular-nums text-ink-1">{item.value}</span>
            {item.name}
          </li>
        ))}
      </ul>
    </div>
  );
}

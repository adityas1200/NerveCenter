import { CalendarClock } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button, Input, Popover, PopoverContent, PopoverTrigger } from "@/components/ui";
import { cn } from "@/lib/utils";
import { RANGE_PRESETS, fromLocalInputValue, rangeTitle, toLocalInputValue, type RangePreset, type RangeState } from "@/lib/timeRange";

const QUICK_WINDOWS: ReadonlyArray<{ label: string; hours: number }> = [
  { label: "Last 6 h", hours: 6 },
  { label: "Last 48 h", hours: 48 },
  { label: "Last 30 days", hours: 30 * 24 },
];

/**
 * Segmented control for the reporting window. One thumb slides under the
 * active segment; the last segment opens a popover for an exact date-and-time window.
 */
export function TimeRangePicker({ value, onChange, className, presets = RANGE_PRESETS, label = "Reporting period", align = "end", quickWindows = true }: {
  value: RangeState;
  onChange: (next: RangeState) => void;
  className?: string;
  presets?: ReadonlyArray<{ preset: RangePreset; label: string }>;
  /** Accessible name of the radiogroup. */
  label?: string;
  align?: "start" | "end";
  /** Show the "Last 6 h / 48 h / 30 days" shortcuts and the local-zone note in the custom popover. */
  quickWindows?: boolean;
}) {
  const fieldId = useId();
  const [customOpen, setCustomOpen] = useState(false);
  const [draft, setDraft] = useState<RangeState>(value);
  const groupRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);
  const activeIndex = Math.max(0, presets.findIndex((item) => item.preset === value.preset));
  const customTitle = rangeTitle(value);

  // Segments are not equal width (the custom one shows its window), so the thumb is measured, not computed.
  useLayoutEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const measure = () => {
      const active = group.querySelectorAll<HTMLButtonElement>("[role=radio]")[activeIndex];
      if (active) setThumb({ left: active.offsetLeft, width: active.offsetWidth });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(group);
    return () => observer.disconnect();
  }, [activeIndex, customTitle]);

  const select = (preset: RangePreset) => {
    if (preset === "custom") { setDraft(value.preset === "custom" ? value : { preset: "custom" }); setCustomOpen(true); return; }
    onChange({ preset });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = (activeIndex + (event.key === "ArrowRight" ? 1 : -1) + presets.length) % presets.length;
    select(presets[next].preset);
    groupRef.current?.querySelectorAll<HTMLButtonElement>("[role=radio]")[next]?.focus();
  };

  const applyCustom = () => {
    if (!draft.from && !draft.to) return;
    onChange({ preset: "custom", from: draft.from, to: draft.to });
    setCustomOpen(false);
  };

  const quick = (hours: number) => {
    const now = Date.now();
    setDraft({ preset: "custom", from: new Date(now - hours * 3_600_000).toISOString(), to: new Date(now).toISOString() });
  };

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={cn("relative flex h-8 shrink-0 items-stretch rounded-lg bg-surface-subtle p-0.5", className)}
    >
      <span
        aria-hidden="true"
        className={cn("segmented-thumb pointer-events-none absolute inset-y-0.5 rounded-md bg-raised shadow-card", thumb ? "opacity-100" : "opacity-0")}
        style={thumb ? { transform: `translateX(${thumb.left}px)`, width: thumb.width, left: 0 } : undefined}
      />
      {presets.map((item) => {
        const active = item.preset === value.preset;
        const isCustom = item.preset === "custom";
        const label = isCustom && active ? customTitle : item.label;
        const segment = (
          <button
            key={item.preset}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={item.label}
            title={isCustom && active ? customTitle : undefined}
            tabIndex={active ? 0 : -1}
            onClick={() => select(item.preset)}
            className={cn(
              "relative z-10 flex h-full min-w-0 items-center justify-center gap-1 whitespace-nowrap rounded-md px-3 text-[13px] transition-colors",
              isCustom && "max-w-[200px]",
              active ? "font-semibold text-ink-1" : "font-medium text-ink-4 hover:text-ink-2",
            )}
          >
            {isCustom ? <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
            <span className="truncate">{label}</span>
          </button>
        );
        if (!isCustom) return segment;
        return (
          <Popover key="custom" open={customOpen} onOpenChange={setCustomOpen}>
            <PopoverTrigger asChild>{segment}</PopoverTrigger>
            <PopoverContent align={align} className="w-80 space-y-3 p-4">
              <div>
                <p className="text-[14px] font-semibold text-ink-1">Custom period</p>
                {quickWindows ? <p className="mt-0.5 text-[12.5px] text-ink-4">Times are in your local zone.</p> : null}
              </div>
              {quickWindows ? (
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_WINDOWS.map((window) => (
                    <button key={window.hours} type="button" onClick={() => quick(window.hours)} className="rounded-md border border-line px-2 py-1 text-[12.5px] font-medium text-ink-3 transition-colors hover:border-line-strong hover:text-ink-1">
                      {window.label}
                    </button>
                  ))}
                </div>
              ) : null}
              <label htmlFor={`${fieldId}-from`} className="block text-[12.5px] font-medium text-ink-3">
                From
                <Input id={`${fieldId}-from`} type="datetime-local" className="mt-1" value={toLocalInputValue(draft.from)} max={toLocalInputValue(draft.to) || undefined} onChange={(event) => setDraft((current) => ({ ...current, preset: "custom", from: fromLocalInputValue(event.target.value) }))} />
              </label>
              <label htmlFor={`${fieldId}-to`} className="block text-[12.5px] font-medium text-ink-3">
                To
                <Input id={`${fieldId}-to`} type="datetime-local" className="mt-1" value={toLocalInputValue(draft.to)} min={toLocalInputValue(draft.from) || undefined} onChange={(event) => setDraft((current) => ({ ...current, preset: "custom", to: fromLocalInputValue(event.target.value) }))} />
              </label>
              <div className="flex justify-end gap-2 pt-1">
                <Button size="sm" variant="outline" onClick={() => setCustomOpen(false)}>Cancel</Button>
                <Button size="sm" variant="primary" disabled={!draft.from && !draft.to} onClick={applyCustom}>Apply</Button>
              </div>
            </PopoverContent>
          </Popover>
        );
      })}
    </div>
  );
}

/* eslint-disable react-refresh/only-export-components -- formatter and component intentionally share the time-of-day contract */
import { Clock } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * A time of day ("HH:MM", 24-hour, matching <input type="time">'s value format), picked from a
 * list of common times (30-minute steps) rather than the browser's native time-picker popup, which
 * looks out of place next to the rest of the app's styled controls.
 *
 * Built on the same Select primitive as the Timezone picker beside it, not a custom Popover: Select's
 * Viewport has its own scroll-up/down buttons designed to work nested inside a Dialog. A plain
 * scrolling div (an earlier version of this component) fought with the Dialog's scroll lock and could
 * not be scrolled at all once opened.
 */

const STEP_MINUTES = 30;
const SLOTS: string[] = Array.from({ length: (24 * 60) / STEP_MINUTES }, (_, index) => {
  const minutes = index * STEP_MINUTES;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
});

/** "09:00" -> "9:00 AM", matching the AM/PM words the routine's own schedule sentence already uses (backend/src/routines/cron.mjs). Falls back to the raw value if it is not HH:MM. */
export function formatTimeOfDay(value: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return value;
  const hour = Number(match[1]);
  const period = hour < 12 ? "AM" : "PM";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:${match[2]} ${period}`;
}

export function TimeOfDayPicker({ value, onChange, "aria-label": ariaLabel, className }: { value: string; onChange: (value: string) => void; "aria-label": string; className?: string }) {
  // A saved routine may have been made with an off-grid minute (e.g. from the old free-text input);
  // keep it selectable even though it is not one of the 30-minute slots, instead of silently losing it.
  const options = SLOTS.includes(value) || !value ? SLOTS : [value, ...SLOTS].sort();
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={ariaLabel} className={cn("gap-2", className)}>
        <Clock className="h-3.5 w-3.5 shrink-0 text-ink-5" aria-hidden="true" />
        <SelectValue>{formatTimeOfDay(value)}</SelectValue>
      </SelectTrigger>
      <SelectContent>{options.map((slot) => <SelectItem key={slot} value={slot}>{formatTimeOfDay(slot)}</SelectItem>)}</SelectContent>
    </Select>
  );
}

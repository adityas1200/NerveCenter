/* eslint-disable react-refresh/only-export-components -- the dial positions are data the tests and PermissionMenu share */
import { Eye, FastForward, ListChecks, Zap, type LucideIcon } from "lucide-react";
import { useRef, type KeyboardEvent } from "react";
import { PERMISSION_HELP, PERMISSION_LABEL, type TaskPermission } from "@/api/tasks";
import { cn } from "@/lib/utils";

/**
 * A task's permission, as positions a person can read at a glance, from least to most freedom:
 * Look only, Ask first, Follow policy. A fourth, admin-only position, Never ask (allow), appears
 * only when `allowUnrestricted` is set, or when the value already is `allow` so the current
 * setting is never hidden. Words and help lines are PERMISSION_LABEL and PERMISSION_HELP.
 *
 * The compact form is PermissionMenu (a pill in a composer footer); this is the expanded form for
 * pages and dialogs that have room for the help line.
 */
export interface DialPosition { value: TaskPermission; label: string; help: string }

export const DIAL_POSITIONS: ReadonlyArray<DialPosition> = [
  ...(["read-only", "ask", "policy", "allow"] as const).map((value) => ({ value, label: PERMISSION_LABEL[value], help: PERMISSION_HELP[value] })),
];

/** One glyph per position, for the composer's mode picker and the suggestion cards. */
export const DIAL_ICON: Record<TaskPermission, LucideIcon> = { "read-only": Eye, ask: ListChecks, policy: Zap, allow: FastForward };

/**
 * Safest-to-riskiest colour, reusing the app's existing risk vocabulary rather than inventing new
 * colours: the same emerald/slate/orange/rose family PriorityBadge and OperationalStatus already use
 * for "safe" through "critical". One shared map so every place a permission shows - this dial, the
 * composer's PermissionMenu, the New Task suggestion cards - agrees on the same colour for the same
 * level, instead of three screens each inventing their own (or none at all).
 */
export const PERMISSION_TONE: Record<TaskPermission, string> = {
  "read-only": "border-emerald-200 bg-emerald-50 text-emerald-700",
  ask: "border-slate-200 bg-slate-50 text-slate-700",
  policy: "border-orange-200 bg-orange-50 text-orange-700",
  allow: "border-rose-200 bg-rose-50 text-rose-700",
};

/** The dial word for a permission, for places that only have room for one word. */
export const DIAL_LABEL: Record<TaskPermission, string> = Object.fromEntries(DIAL_POSITIONS.map((position) => [position.value, position.label])) as Record<TaskPermission, string>;

export interface AutonomyDialProps {
  value: TaskPermission;
  onChange: (value: TaskPermission) => void;
  disabled?: boolean;
  /** Show the admin-only "Never ask" position. */
  allowUnrestricted?: boolean;
  /** Accessible name of the group. */
  label?: string;
  /** Hide the help line, for tight rows that show it elsewhere. */
  hideHelp?: boolean;
  className?: string;
}

export function AutonomyDial({ value, onChange, disabled = false, allowUnrestricted = false, label = "Permission", hideHelp = false, className }: AutonomyDialProps) {
  const ref = useRef<HTMLDivElement>(null);
  const positions = DIAL_POSITIONS.filter((position) => position.value !== "allow" || allowUnrestricted || value === "allow");
  const index = positions.findIndex((position) => position.value === value);
  const selected = index >= 0 ? positions[index] : null;

  const move = (step: number) => {
    if (disabled || !positions.length) return;
    const next = ((index < 0 ? 0 : index) + step + positions.length) % positions.length;
    onChange(positions[next].value);
    ref.current?.querySelectorAll<HTMLButtonElement>("[role=radio]")[next]?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") { event.preventDefault(); move(1); }
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") { event.preventDefault(); move(-1); }
    else if (event.key === "Home") { event.preventDefault(); move(-index); }
    else if (event.key === "End") { event.preventDefault(); move(positions.length - 1 - index); }
  };

  return (
    <div className={cn("min-w-0", className)} data-testid="autonomy-dial">
      <div
        ref={ref}
        role="radiogroup"
        aria-label={label}
        aria-disabled={disabled || undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        // Content-sized, not stretched to fill the row: same look as the app's other pill filters
        // (Tabs/TabsList/TabsTrigger, e.g. Notifications' "All · Sonic · Tickets and pipelines"), whose
        // exact classes this mirrors. A fill-the-row layout (equal columns, or equal-plus-leftover) always
        // fights the longest label, either overflowing it or padding the short ones more than they need.
        className="inline-flex h-9 items-center justify-center rounded-xl border border-line bg-surface-subtle p-1"
      >
        {positions.map((position, i) => {
          const active = i === index;
          return (
            <button
              key={position.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              tabIndex={active || (index < 0 && i === 0) ? 0 : -1}
              onClick={() => { if (!disabled && !active) onChange(position.value); }}
              className={cn(
                "inline-flex h-7 items-center justify-center whitespace-nowrap rounded-lg px-3 text-[13px] font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/25 disabled:cursor-default",
                active ? cn("border font-semibold shadow-card", PERMISSION_TONE[position.value]) : "text-ink-4",
                !active && !disabled && "hover:text-ink-1",
                disabled && !active && "text-ink-5",
              )}
            >
              {position.label}
            </button>
          );
        })}
      </div>
      {!hideHelp ? <p className="mt-1.5 min-h-[18px] text-[12.5px] leading-[18px] text-ink-4" data-testid="autonomy-dial-help">{selected ? selected.help : ""}</p> : null}
    </div>
  );
}

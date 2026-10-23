import { Check, ChevronDown } from "lucide-react";
import { PERMISSION_HELP, type TaskPermission } from "@/api/tasks";
import { DIAL_ICON, DIAL_LABEL, DIAL_POSITIONS, PERMISSION_TONE } from "@/components/ops/AutonomyDial";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * What the agent may do, as a mode chip in the composer footer that opens upward, the way Claude
 * Code and ChatGPT pick a mode: the compact form of AutonomyDial. Options run from least to most
 * freedom (Look only, Ask first, Follow policy, Never ask), each with its glyph and one help line.
 * Every position uses the same safest-to-riskiest colour as the dial (PERMISSION_TONE) so the chip,
 * this menu, and the New Task suggestion cards all agree on what each level looks like.
 */
export function PermissionMenu({ value, onChange, disabled = false, side = "top", allowUnrestricted = true, scope = "this task", prefix }: {
  value: TaskPermission;
  onChange: (value: TaskPermission) => void;
  disabled?: boolean;
  side?: "top" | "bottom";
  /** Offer the admin-only Never ask. */
  allowUnrestricted?: boolean;
  /** Ends the menu title, e.g. "this task" or "the new task". */
  scope?: string;
  /** A word before the mode on the chip ("Mode"), so it reads as a setting rather than an action. */
  prefix?: string;
}) {
  const options = DIAL_POSITIONS.filter((position) => position.value !== "allow" || allowUnrestricted || value === "allow");
  const Icon = DIAL_ICON[value];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          aria-label={`Permission: ${DIAL_LABEL[value]}`}
          title={PERMISSION_HELP[value]}
          className={cn(
            "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/25 disabled:opacity-50 hover:brightness-95 data-[state=open]:brightness-95",
            PERMISSION_TONE[value],
          )}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          {prefix ? <span className="font-normal opacity-75">{prefix}:</span> : null}
          {DIAL_LABEL[value]}
          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side={side} sideOffset={8} className="w-[340px] p-1.5">
        <DropdownMenuLabel className="px-2.5 pb-1.5 pt-1.5 text-[12px] font-medium normal-case tracking-normal text-ink-4">Permission for {scope}</DropdownMenuLabel>
        {options.map(({ value: option }) => {
          const selected = option === value;
          const OptionIcon = DIAL_ICON[option];
          return (
            <DropdownMenuItem key={option} onSelect={() => onChange(option)} className={cn("h-auto items-start gap-3 rounded-lg px-2.5 py-2.5", selected && "bg-surface-subtle")}>
              <span className={cn("mt-px flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border", PERMISSION_TONE[option])}>
                <OptionIcon className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-semibold leading-5 text-ink-1">{DIAL_LABEL[option]}</span>
                <span className="block whitespace-normal text-[12.5px] font-normal leading-[18px] text-ink-4">{PERMISSION_HELP[option]}</span>
              </span>
              <Check className={cn("mt-1 h-4 w-4 shrink-0", selected ? "text-brand" : "text-transparent")} aria-hidden="true" />
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

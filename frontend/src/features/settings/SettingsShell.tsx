import type { ReactNode } from "react";
import { Button, Card } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * Layout primitives for Settings: a sticky left section nav with the content column beside it,
 * flat section cards with a Save footer, and a label-plus-help field.
 */

export interface SettingsNavItem<Id extends string> {
  id: Id;
  label: string;
}

export function SettingsShell<Id extends string>({ items, active, onSelect, children }: { items: ReadonlyArray<SettingsNavItem<Id>>; active: Id; onSelect: (id: Id) => void; children: ReactNode }) {
  return (
    <div className="flex items-start gap-8">
      <nav aria-label="Settings sections" className="sticky top-[72px] w-[180px] shrink-0">
        <div role="tablist" aria-orientation="vertical" className="flex flex-col gap-0.5">
          {items.map((item) => {
            const selected = item.id === active;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                id={`settings-tab-${item.id}`}
                aria-selected={selected}
                aria-controls={`settings-panel-${item.id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => onSelect(item.id)}
                className={cn(
                  "flex h-9 w-full items-center rounded-lg px-3 text-left text-[14px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/20",
                  selected ? "bg-brand/[0.08] font-semibold text-brand" : "text-ink-3 hover:bg-surface-subtle",
                )}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </nav>
      <div role="tabpanel" id={`settings-panel-${active}`} aria-labelledby={`settings-tab-${active}`} className="min-w-0 max-w-[880px] flex-1">
        {children}
      </div>
    </div>
  );
}

/** A flat section card: title row, body, and an optional footer (usually a SaveFooter). */
export function SettingsSection({ title, action, footer, children, className }: { title: ReactNode; action?: ReactNode; footer?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={cn("shell-card-quiet overflow-hidden bg-raised", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
        <h2 className="flex min-w-0 items-center gap-1.5 text-[15.5px] font-semibold text-ink-1">{title}</h2>
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </div>
      <div className="px-5 pb-5 pt-4">{children}</div>
      {footer}
    </Card>
  );
}

export function SaveFooter({ pending, disabled, dirty = !disabled, onSave }: { pending: boolean; disabled?: boolean; dirty?: boolean; onSave: () => void }) {
  return (
    <div className="flex items-center justify-end gap-3 border-t border-line px-5 py-3" data-auto-refresh-block={pending || dirty}>
      <Button variant="primary" size="sm" disabled={pending || disabled} onClick={onSave}>{pending ? "Saving" : "Save"}</Button>
    </div>
  );
}

/** Label above the control, one help line below it. `tip` renders an InfoTip beside the label. */
export function Field({ label, htmlFor, help, tip, children, className }: { label: string; htmlFor: string; help?: string; tip?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="mb-1.5 flex items-center gap-1.5">
        <label htmlFor={htmlFor} className="block text-[14px] font-medium text-ink-2">{label}</label>
        {tip}
      </div>
      {children}
      {help ? <p className="mt-1.5 text-[13px] leading-4 text-ink-4">{help}</p> : null}
    </div>
  );
}

/** A group heading inside a section that holds more than one topic. */
export function GroupHeading({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-[14px] font-semibold text-ink-1">{children}</h3>
      {action}
    </div>
  );
}

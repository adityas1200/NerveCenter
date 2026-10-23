import { cn } from "@/lib/utils";

/** A row of choices where one is on, the active one raised above its track (radio semantics). */
export function Segmented<T extends string>({ label, value, options, onChange, wide = false, className }: { label: string; value: T; options: ReadonlyArray<readonly [T, string]>; onChange: (value: T) => void; wide?: boolean; className?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex rounded-[10px] bg-ink-1/[0.05] p-[3px]", wide && "flex", className)}>
      {options.map(([id, text]) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={value === id}
          onClick={() => onChange(id)}
          className={cn(
            "h-8 rounded-[7px] px-3 text-[13px] font-medium transition-[background-color,color,box-shadow] duration-150",
            wide && "flex-1",
            value === id ? "bg-elevated text-ink-1 shadow-[0_1px_2px_rgb(0_0_0/0.08),0_0_0_1px_rgb(var(--c-ink-1)/0.06)]" : "text-ink-4 hover:text-ink-2",
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/** The mono uppercase label above a field on the pages outside a project. */
export function FieldLabel({ children, htmlFor }: { children: string; htmlFor?: string }) {
  return <label htmlFor={htmlFor} className="mb-2 block font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-ink-4">{children}</label>;
}

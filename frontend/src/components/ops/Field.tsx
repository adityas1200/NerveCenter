import type { ReactNode } from "react";

/** A labelled form control in a dialog: the label above, an optional hint below; `wide` spans both columns of a two-column grid. */
export function Field({ label, htmlFor, hint, required, wide, children }: { label: string; htmlFor: string; hint?: string; required?: boolean; wide?: boolean; children: ReactNode }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <label htmlFor={htmlFor} className="mb-1 block text-[13px] font-medium text-ink-3">{label}{required ? <span className="text-rose-600"> *</span> : null}</label>
      {children}
      {hint ? <p className="mt-1 text-[11.5px] text-ink-5">{hint}</p> : null}
    </div>
  );
}

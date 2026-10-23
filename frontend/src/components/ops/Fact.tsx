import { cn } from "@/lib/utils";

/** One label-and-value pair of a detail sheet's `<dl>`. `wrap` keeps line breaks instead of truncating; `mono` is for ids. */
export function Fact({ label, value, title, wrap = false, mono = false }: { label: string; value: string; title?: string; wrap?: boolean; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-ink-5">{label}</dt>
      <dd className={cn("mt-0.5 text-[14px] font-medium text-ink-1", wrap ? "whitespace-pre-wrap" : "truncate", mono && "font-mono text-[13px]")} title={title || value}>{value}</dd>
    </div>
  );
}

import type { ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { Button, Skeleton, RelativeTime } from "@/components/ui";

export function RefreshTimestamp({ value, label }: { value?: string; label?: string }) {
  return value ? <span aria-label={label ? `${label} update time` : undefined}>Updated <RelativeTime value={value} /></span> : null;
}

/** Independent loading/error boundary for a manually refreshed section. */
export function RefreshRegion({ label, query, children, showTimestamp = true }: { label: string; query: { data?: { generatedAt?: string }; isPending: boolean; isFetching: boolean; error: unknown; refetch: (options: { cancelRefetch: boolean }) => unknown }; children: ReactNode; showTimestamp?: boolean }) {
  return <section aria-label={label} aria-busy={query.isFetching} className="space-y-3">
    {showTimestamp || query.isFetching ? <div className="flex items-center justify-end gap-2 text-[12px] text-ink-4">
      {query.isFetching ? <span role="status" className="inline-flex items-center gap-2"><LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />Loading {label}</span> : null}
      {showTimestamp ? <RefreshTimestamp value={query.data?.generatedAt} /> : null}
    </div> : null}
    {query.error ? <div role="alert" className="flex items-center gap-3 text-[13px] text-rose-600">Could not refresh {label}.<Button variant="outline" size="sm" disabled={query.isFetching} onClick={() => query.refetch({ cancelRefetch: false })}>Try again</Button></div> : null}
    {query.isPending ? <div className="space-y-3" aria-hidden="true"><Skeleton className="h-5 w-36" /><div className="grid grid-cols-2 gap-3 md:grid-cols-4">{[0, 1, 2, 3].map(n => <Skeleton key={n} className="h-24 rounded-xl" />)}</div><Skeleton className="h-36 rounded-xl" /></div> : children}
  </section>;
}

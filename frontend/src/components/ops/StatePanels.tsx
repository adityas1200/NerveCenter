import { LoaderCircle, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useInRouterContext } from "react-router-dom";
import { ErrorNotice } from "@/components/ops/ErrorNotice";
import { Button, Skeleton } from "@/components/ui";
import { cn } from "@/lib/utils";

/** How many stat tiles a page shows above its table; 0 for list-only pages such as Inbox or Routines. */
export type SkeletonTiles = 0 | 3 | 4 | 6;

function TileSkeletonRow({ count = 6 }: { count?: Exclude<SkeletonTiles, 0> }) {
  return (
    <div className={cn("grid grid-cols-2 gap-3", count === 6 ? "md:grid-cols-3 xl:grid-cols-6" : count === 4 ? "md:grid-cols-4" : "md:grid-cols-3")}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex min-h-[124px] flex-col justify-between rounded-2xl border border-line bg-raised p-4">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-8 w-14" />
          <Skeleton className="h-2.5 w-24" />
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("rounded-2xl border border-line bg-raised", className)} aria-hidden="true">
      <div className="flex gap-6 border-b border-line bg-surface-subtle/60 px-4 py-3">
        <Skeleton className="h-2.5 w-28" /><Skeleton className="h-2.5 w-16" /><Skeleton className="h-2.5 w-20" /><Skeleton className="h-2.5 w-14" />
      </div>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-6 border-b border-line px-4 py-3 last:border-0">
          <Skeleton className="h-3 w-48" /><Skeleton className="h-3 w-16" /><Skeleton className="h-5 w-20 rounded-full" /><Skeleton className="ml-auto h-3 w-14" />
        </div>
      ))}
    </div>
  );
}

function PageSkeleton({ tiles = 6, label = "Loading" }: { tiles?: SkeletonTiles; label?: string }) {
  return (
    <div role="status" aria-live="polite" className="space-y-6">
      <span className="sr-only">{label}</span>
      {tiles ? <TileSkeletonRow count={tiles} /> : null}
      <TableSkeleton />
    </div>
  );
}

export interface QueryStateLike {
  isPending: boolean;
  isFetching?: boolean;
  isPlaceholderData?: boolean;
  data?: unknown;
  error: unknown;
}

/** Backend messages that carry a method, a URL, a status code or a socket error are for the Details disclosure, not the headline. */
function isTechnicalMessage(message: string): boolean {
  return /\b(GET|POST|PUT|PATCH|DELETE) |failed \(|https?:\/\/|ECONN|ENOTFOUND|ETIMEDOUT/.test(message);
}

/**
 * One plain sentence for why a request failed, from the backend's message. Mirrors the wording the
 * Overview and Pipelines pages use for connection problems, so the same failure reads the same everywhere.
 */
function plainFailureReason(message: string): string {
  const text = String(message || "");
  if (/403|invalid access token|unauthori[sz]ed/i.test(text)) return "The connected platform rejected the access token.";
  if (/401|not signed in|session expired/i.test(text)) return "Your session has expired or the sign-in was rejected.";
  if (/404|not found/i.test(text)) return "The backend does not have what this page asked for.";
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|Failed to fetch|NetworkError|network/i.test(text)) return "The NerveCenter backend could not be reached.";
  if (/5\d\d|internal server error/i.test(text)) return "The backend hit an error while answering.";
  const configure = text.match(/Configure an? (\w+) connection/i);
  if (configure) return `No ${configure[1]} connection is configured.`;
  if (/not configured|not connected/i.test(text)) return "A connection this page needs is not set up.";
  return "A request to the backend failed.";
}

export function QueryState({ query, children, loadingLabel = "Loading", skeleton, tiles, onRetry }: {
  query: QueryStateLike;
  children: ReactNode;
  loadingLabel?: string;
  skeleton?: ReactNode;
  /** Stat tiles in the default skeleton. Pages without a stat strip pass 0. */
  tiles?: SkeletonTiles;
  /** Reload the query from the error card. Without it the card points at Connectors for connection problems. */
  onRetry?: () => void;
}) {
  const inRouter = useInRouterContext();
  if (query.isPending || query.isPlaceholderData) return <>{skeleton ?? <PageSkeleton label={loadingLabel} tiles={tiles} />}</>;
  if (query.error) {
    const message = query.error instanceof Error ? query.error.message : "Backend request failed";
    const technical = isTechnicalMessage(message);
    const next = onRetry
      ? <Button size="sm" variant="outline" className="border border-line bg-raised" onClick={onRetry}>Try again</Button>
      : technical
        ? (inRouter ? <Link to="/connectors" className="font-medium text-brand hover:text-brand-hover">Check Connectors</Link> : <a href="/connectors" className="font-medium text-brand hover:text-brand-hover">Check Connectors</a>)
        : null;
    return <>{query.data ? children : null}<ErrorNotice what="NerveCenter could not load this page." why={technical ? plainFailureReason(message) : message} next={next} detail={technical ? message : null} /></>;
  }
  return <div aria-busy={query.isFetching}>{query.isFetching ? <p role="status" className="mb-2 flex items-center gap-2 text-[12px] text-ink-4"><LoaderCircle className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />Refreshing</p> : null}{children}</div>;
}

/** A quiet one-liner for "nothing here". Keep the copy to a few words. */
export function CompactEmptyState({ children, icon: Icon, className }: { children: ReactNode; icon?: LucideIcon; className?: string }) {
  return (
    <p className={cn("flex items-center gap-2 px-1 py-4 text-[13.5px] text-ink-4", className)}>
      {Icon ? <Icon className="h-4 w-4 shrink-0 text-ink-5" aria-hidden="true" /> : null}
      {children}
    </p>
  );
}

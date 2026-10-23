/** SPEC-platform-manual-refresh FR-1. Notification intervals are explicitly opted in. */
export const manualQueryDefaults = { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false } as const;

/**
 * How long a read is reused before a newly mounted reader fetches it again (`staleTime`). A page's own data keeps the
 * default of 0 so opening the page fetches it (FR-1); these tiers are for reads that shell parts, pickers and dialogs share.
 * Pick a tier rather than a new number; changing a tier's value changes every reader on it.
 */
export const FRESH = {
  /** A board while its widgets are being built. */
  live: 3_000,
  /** What Sonic is running, behind the pill. */
  activity: 5_000,
  /** The inbox count in the shell. */
  badge: 10_000,
  /** Palette task lists and import previews. */
  short: 15_000,
  /** Settings and connectors the shell reads, people pickers, the ticket lists behind search. */
  medium: 30_000,
  /** Projects, access, boards, routines, connections, stats. */
  long: 60_000,
  /** Who the person is, app meta, and catalogues that change rarely (skills, knowledge, tables, templates). */
  session: 5 * 60_000,
} as const;

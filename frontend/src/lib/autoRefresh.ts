/** SPEC-platform-page-auto-refresh FR-1: public, build-time seconds; zero opts out. */
export function autoRefreshSeconds(raw: unknown): number {
  if (typeof raw !== "string" || !raw.trim()) return 300;
  const seconds = Number(raw);
  return Number.isSafeInteger(seconds) && seconds >= 0 ? seconds : 300;
}

export const AUTO_REFRESH_SECONDS = autoRefreshSeconds(import.meta.env.VITE_AUTO_REFRESH_SECONDS);

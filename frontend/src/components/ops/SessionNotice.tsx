import { useEffect, useRef, useSyncExternalStore } from "react";
import { getSessionNotice, subscribeSessionNotice } from "@/api/session";
import { cookieAuthEnabled, isSigningOut } from "@/auth-session";
import { useToast } from "@/components/ui/toast";
import { goTo } from "@/lib/appRouterCore";

/** SPEC-platform-16 FR-3/FR-4: mounted outside AuthGate, including during bootstrap. */
export function SessionNotice() {
  const notice = useSyncExternalStore(subscribeSessionNotice, getSessionNotice);
  const shown = useRef<number | null>(null);
  const toast = useToast();
  useEffect(() => {
    if (!notice) return;
    if (shown.current !== notice.id) {
      shown.current = notice.id;
      toast.error(notice.kind === "expired" ? "Your session has expired. Please sign in again." : "Could not verify your session. Please try again.");
    }
    if (notice.kind !== "expired") return;
    const timer = window.setTimeout(() => {
      if (cookieAuthEnabled() && !isSigningOut()) goTo("/login", { replace: true });
    }, 3_000);
    return () => window.clearTimeout(timer);
  }, [notice, toast]);
  return null;
}

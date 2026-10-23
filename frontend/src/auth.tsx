import { ReactNode, useEffect, useState, useSyncExternalStore } from "react";
import { apiBase, cacheUser, clearRequestedPath, cookieAuthEnabled, getAuthenticatedUser, isLoginPath, platformAuth, rememberPlatformMe, rememberRequestedPath, requestedPath } from "@/auth-session";
import { clearSessionNotice, expireCookieSession, getSessionNotice, readCookieSession, reportSessionUnavailable, sessionExpired, subscribeSessionNotice, type CookieSession } from "@/api/session";
import { Button } from "@/components/ui/button";
import { useLocation } from "react-router-dom";
import { appHistory, goTo } from "@/lib/appRouterCore";
import { LoginPage } from "@/features/login/LoginPage";

function authEnabled(): boolean {
  return platformAuth || cookieAuthEnabled();
}

async function session(): Promise<CookieSession> {
  // The hosting platform (a Databricks App's proxy) signed the user in before the page loaded; ask the backend who it is.
  if (platformAuth) return platformSession();
  return readCookieSession();
}

async function platformSession(): Promise<CookieSession> {
  try {
    const response = await fetch(`${apiBase}/api/me`, { credentials: "include" });
    if (!response.ok) return { authenticated: false, user: null };
    const me = (await response.json()) as { user?: { id: string; name?: string; email?: string } };
    const { user } = me;
    if (user) rememberPlatformMe(me);
    return user ? { authenticated: true, user: { id: user.id, name: user.name || user.id, email: user.email || user.id } } : { authenticated: false, user: null };
  } catch {
    return { authenticated: false, user: null };
  }
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<"checking" | "authenticated" | "anonymous" | "unavailable">(() => (authEnabled() ? "checking" : "authenticated"));
  const [attempt, setAttempt] = useState(0);
  const notice = useSyncExternalStore(subscribeSessionNotice, getSessionNotice);
  const expired = notice?.kind === "expired";

  // Subscribing re-renders the gate when the address changes, so the /login check below stays current.
  useLocation();
  const leaveLogin = status === "authenticated" && isLoginPath() && !expired;

  useEffect(() => {
    if (!leaveLogin) return;
    const target = requestedPath();
    clearRequestedPath();
    appHistory.replace(target);
  }, [leaveLogin]);

  useEffect(() => {
    if (!authEnabled()) return;
    let active = true;
    const previouslySignedIn = Boolean(getAuthenticatedUser());
    void session().then(({ authenticated, user, unauthorized }) => {
      if (!active) return;
      if (!authenticated || !user) {
        // Under platform auth there is no login page to send anyone to; the API answers 401 itself.
        if (platformAuth) {
          cacheUser(null);
          setStatus("authenticated");
          return;
        }
        // FR-4: bootstrap expiry uses the same visible notice as a protected API 401.
        if (unauthorized || previouslySignedIn || sessionExpired()) {
          expireCookieSession();
          return;
        }
        cacheUser(null);
        // FR-1: show our own sign-in page, keeping the asked-for path for the button's redirect.
        rememberRequestedPath();
        if (!isLoginPath()) goTo("/login", { replace: true });
        setStatus("anonymous");
        return;
      }
      clearSessionNotice();
      cacheUser(user);
      setStatus("authenticated");
    }).catch(() => {
      if (!active) return;
      reportSessionUnavailable();
      setStatus("unavailable");
    });
    return () => { active = false; };
  }, [attempt]);

  if (expired && isLoginPath()) return <LoginPage />;

  if (status === "unavailable") {
    return <div role="alert" className="flex min-h-screen items-center justify-center gap-3 bg-canvas text-[14px] text-ink-3">
      Could not verify your session. Please try again.
      <Button variant="outline" onClick={() => { setStatus("checking"); setAttempt(value => value + 1); }}>Try again</Button>
    </div>;
  }

  if (status === "checking") {
    return <div role="status" className="flex min-h-screen items-center justify-center bg-canvas text-[14px] text-ink-4">Verifying authentication...</div>;
  }

  if (status === "anonymous") return <LoginPage />;

  // FR-4: a signed-in visitor never sees the sign-in page.
  if (leaveLogin) return null;

  return <>{children}</>;
}

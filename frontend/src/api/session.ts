import { authBase, cacheUser, cookieAuthEnabled, isLoginPath, isSigningOut, rememberRequestedPath, type AuthUser } from "@/auth-session";

export interface CookieSession {
  authenticated: boolean;
  user: AuthUser | null;
  unauthorized?: boolean;
}

export class SessionCheckError extends Error {
  constructor() {
    super("Could not verify your session. Please try again.");
    this.name = "SessionCheckError";
  }
}

type SessionNotice = { id: number; kind: "expired" | "unavailable" };
let notice: SessionNotice | null = null;
let sequence = 0;
const listeners = new Set<() => void>();
let sessionCheck: Promise<CookieSession> | null = null;

export function subscribeSessionNotice(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export const getSessionNotice = () => notice;

function publish(kind: SessionNotice["kind"] | null): void {
  if (notice?.kind === "expired" && kind === "unavailable") return;
  if ((notice?.kind ?? null) === kind) return;
  notice = kind ? { id: ++sequence, kind } : null;
  for (const listener of listeners) listener();
}

export function clearSessionNotice(): void { publish(null); }
export function sessionExpired(): boolean { return notice?.kind === "expired"; }

export function expireCookieSession(): void {
  if (!cookieAuthEnabled() || isSigningOut() || sessionExpired()) return;
  rememberRequestedPath();
  cacheUser(null);
  publish("expired");
}

export function reportSessionUnavailable(): void {
  if (cookieAuthEnabled() && !isSigningOut()) publish("unavailable");
}

// SPEC-platform-16 FR-2/FR-6: this verifies a cookie; the provider has no renewal/expiry contract.
export function readCookieSession(): Promise<CookieSession> {
  if (sessionCheck) return sessionCheck;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 5_000);
  const pending = (async (): Promise<CookieSession> => {
    try {
      const response = await fetch(`${authBase}/session`, {
        credentials: "include", cache: "no-store", headers: { accept: "application/json" }, signal: controller.signal,
      });
      if (response.status === 401) return { authenticated: false, user: null, unauthorized: true };
      if (!response.ok) throw new SessionCheckError();
      const body: unknown = await response.json();
      if (!body || typeof body !== "object" || !("authenticated" in body) || typeof body.authenticated !== "boolean") throw new SessionCheckError();
      if (!body.authenticated) return { authenticated: false, user: null };
      const user = "user" in body ? body.user : null;
      if (!user || typeof user !== "object" || !("id" in user) || typeof user.id !== "string" || !user.id.trim() || !("name" in user) || typeof user.name !== "string") throw new SessionCheckError();
      return { authenticated: true, user: user as AuthUser };
    } catch (error) {
      if (error instanceof SessionCheckError) throw error;
      throw new SessionCheckError();
    } finally {
      window.clearTimeout(timer);
    }
  })();
  sessionCheck = pending;
  // Register both handlers so the shared request cannot leave an unhandled rejection.
  void pending.then(() => { if (sessionCheck === pending) sessionCheck = null; }, () => { if (sessionCheck === pending) sessionCheck = null; });
  return pending;
}

function withCallerSignal<T>(pending: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return pending;
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException("The operation was aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    void pending.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export function canRecoverCookieSession(): boolean {
  return cookieAuthEnabled() && !isSigningOut() && !isLoginPath() && !sessionExpired();
}

export async function revalidateCookieSession(signal?: AbortSignal | null): Promise<boolean> {
  try {
    signal?.throwIfAborted();
    const session = await withCallerSignal(readCookieSession(), signal);
    signal?.throwIfAborted();
    if (!cookieAuthEnabled() || isSigningOut() || sessionExpired()) return false;
    if (!session.authenticated || !session.user) {
      expireCookieSession();
      return false;
    }
    cacheUser(session.user);
    clearSessionNotice();
    return true;
  } catch (error) {
    signal?.throwIfAborted();
    if (!(error instanceof SessionCheckError)) throw error;
    reportSessionUnavailable();
    return false;
  }
}

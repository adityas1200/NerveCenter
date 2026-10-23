import { leavePageTo } from "@/lib/browserNav";

const SESSION_USER_KEY = "nervecenter_auth_user";
const authApiBase = (import.meta.env.VITE_AUTH_API_BASE_URL || "/dataverse/apps/api/v1").replace(/\/$/, "");

export const authBase = `${authApiBase}/auth`;
// VITE_AUTH_MODE=platform: the hosting platform (a Databricks App) authenticates every request, so there is
// no NerveCenter login page; the user comes from /api/me and signing out belongs to the platform.
export const platformAuth = String(import.meta.env.VITE_AUTH_MODE || "").trim().toLowerCase() === "platform";
export const apiBase = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

let signingOut = false;
export const isSigningOut = () => signingOut;

export function cookieAuthEnabled(): boolean {
  const configured = import.meta.env.VITE_AUTH_ENABLED ?? import.meta.env.VITE_AZURE_SSO_ENABLED;
  return !platformAuth && String(configured ?? (import.meta.env.DEV ? "false" : "true")).trim().toLowerCase() !== "false";
}

export interface AuthUser {
  id: string;
  email?: string;
  name: string;
  azure_oid?: string;
}

export function cacheUser(user: AuthUser | null): void {
  if (!user) {
    sessionStorage.removeItem(SESSION_USER_KEY);
    return;
  }
  sessionStorage.setItem(SESSION_USER_KEY, JSON.stringify(user));
}

// Under platform auth the gate already asked /api/me; useMe takes that answer once instead of asking again.
// Memory only: it carries the role and permissions, which sessionStorage does not need to keep.
let platformMe: unknown;
export function rememberPlatformMe(me: unknown): void { platformMe = me; }
export function takePlatformMe(): unknown { const me = platformMe; platformMe = undefined; return me; }

export function getAuthenticatedUser(): AuthUser | null {
  try {
    const value = sessionStorage.getItem(SESSION_USER_KEY);
    return value ? (JSON.parse(value) as AuthUser) : null;
  } catch {
    return null;
  }
}

function currentPath(): string {
  const { pathname, search, hash } = window.location;
  return `${pathname}${search}${hash}`.startsWith("//") ? "/" : `${pathname}${search}${hash}`;
}

const REQUESTED_PATH_KEY = "nervecenter_requested_path";
const appBase = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
/** The sign-in page's browser path (SPEC-platform-09). */
export const loginPath = `${appBase}/login`;

export function isLoginPath(pathname = window.location.pathname): boolean {
  return pathname === loginPath || pathname === `${loginPath}/`;
}

/** The page asked for before sign-in, kept in this tab so the SSO error return to /login still knows it. */
export function rememberRequestedPath(): void {
  if (isLoginPath()) return;
  sessionStorage.setItem(REQUESTED_PATH_KEY, currentPath());
}

/** Only same-origin app paths, never the login page itself, so a stored value cannot bounce or leave the site. */
export function requestedPath(): string {
  const value = sessionStorage.getItem(REQUESTED_PATH_KEY);
  return value && value.startsWith("/") && !value.startsWith("//") && !isLoginPath(value.split(/[?#]/)[0]) ? value : `${appBase}/`;
}

export function clearRequestedPath(): void {
  sessionStorage.removeItem(REQUESTED_PATH_KEY);
}

/** Sends the browser to the SSO flow, which returns to `path`. */
export function startSso(path = requestedPath()): void {
  leavePageTo(`${authBase}/login?redirect=${encodeURIComponent(path)}`);
}

export function redirectToLogin(): void {
  const redirect = encodeURIComponent(currentPath());
  leavePageTo(`${authBase}/login?redirect=${redirect}`);
}

export async function logout(): Promise<void> {
  signingOut = true;
  cacheUser(null);
  clearRequestedPath();
  if (platformAuth) {
    window.location.reload();
    return;
  }
  try {
    await fetch(`${authBase}/logout`, { method: "POST", credentials: "include" });
  } finally {
    // FR-7: end on the sign-in page, not the SSO page.
    leavePageTo(loginPath);
  }
}

import { getAuthenticatedUser } from "@/auth-session";

const DEFAULT_EMAIL = "demo.user";

function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function initialsFromName(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function getCurrentUser() {
  const authenticatedUser = getAuthenticatedUser();
  const email = String(authenticatedUser?.email || import.meta.env.VITE_DEV_USER_EMAIL || DEFAULT_EMAIL).trim();
  const explicitName = String(authenticatedUser?.name || import.meta.env.VITE_DEV_USER_NAME || "").trim();
  const name = explicitName || nameFromEmail(email);
  return { email, name, initials: initialsFromName(name) || "DU" };
}

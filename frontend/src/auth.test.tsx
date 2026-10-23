import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthGate } from "./auth";
import { authBase, logout } from "@/auth-session";
import { AppRouter } from "@/lib/appRouter";
import { leavePageTo } from "@/lib/browserNav";
import { jsonResponse, mockFetch, renderWithClient } from "@/test/utils";

// SPEC-platform-09 FR-1, FR-4, FR-7 (the gate side).

vi.mock("@/lib/browserNav", () => ({ leavePageTo: vi.fn() }));

const signedIn = { authenticated: true, user: { id: "u", name: "U" } };
function serve(session: unknown) {
  return mockFetch((url) => (url.endsWith("/session") ? jsonResponse(session) : url.endsWith("/api/meta") ? jsonResponse({ adminContacts: [] }) : jsonResponse({}, 404)));
}
const open = (path: string) => {
  window.history.replaceState(null, "", path);
  renderWithClient(<AppRouter><AuthGate><div>app content</div></AuthGate></AppRouter>);
};

beforeEach(() => {
  vi.stubEnv("VITE_AUTH_ENABLED", "true");
  sessionStorage.clear();
  vi.mocked(leavePageTo).mockClear();
});

describe("AuthGate sign-in page", () => {
  it("FR-1: without a session it shows the sign-in page at /login and does not redirect to SSO", async () => {
    serve({ authenticated: false, user: null });
    open("/tickets/42");
    expect(await screen.findByRole("button", { name: "Sign in with SSO" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/login");
    expect(leavePageTo).not.toHaveBeenCalled();
    expect(screen.queryByText("app content")).not.toBeInTheDocument();
  });

  it("FR-1: the button redirect keeps the originally requested path", async () => {
    serve({ authenticated: false, user: null });
    open("/tickets/42?tab=a");
    fireEvent.click(await screen.findByRole("button", { name: "Sign in with SSO" }));
    expect(leavePageTo).toHaveBeenCalledWith(`${authBase}/login?redirect=${encodeURIComponent("/tickets/42?tab=a")}`);
  });

  it("FR-4: a signed-in visitor at /login lands on / without seeing the page", async () => {
    serve(signedIn);
    open("/login");
    expect(await screen.findByText("app content")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign in with SSO" })).not.toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
  });

  it("FR-4: a signed-in visitor at /login goes to the requested path when there is one", async () => {
    sessionStorage.setItem("nervecenter_requested_path", "/tickets/7");
    serve(signedIn);
    open("/login");
    await waitFor(() => expect(window.location.pathname).toBe("/tickets/7"));
  });

  it("FR-7: logout ends on the sign-in page, not the SSO page", async () => {
    serve(signedIn);
    await logout();
    expect(leavePageTo).toHaveBeenCalledWith("/login");
  });
});

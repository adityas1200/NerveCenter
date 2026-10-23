import { fireEvent, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginPage } from "./LoginPage";
import { authBase } from "@/auth-session";
import { leavePageTo } from "@/lib/browserNav";
import { jsonResponse, mockFetch, renderWithClient } from "@/test/utils";

// SPEC-platform-09 FR-2, FR-3, FR-5, FR-6, FR-8, FR-9 (the page side).

vi.mock("@/lib/browserNav", () => ({ leavePageTo: vi.fn() }));

function show(search = "", contacts: string[] = []) {
  const fetchMock = mockFetch((url) => (url.endsWith("/api/meta") ? jsonResponse({ environment: "test", adminContacts: contacts }) : jsonResponse({}, 404)));
  renderWithClient(<MemoryRouter initialEntries={[`/login${search}`]}><LoginPage /></MemoryRouter>);
  return fetchMock;
}

beforeEach(() => {
  sessionStorage.clear();
  vi.mocked(leavePageTo).mockClear();
  document.documentElement.removeAttribute("data-theme");
});

describe("LoginPage", () => {
  it("FR-2: shows the hero, the card copy and the SSO button", () => {
    show();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("The operations harness for data teams.");
    expect(screen.getByAltText("ZS")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    expect(screen.getByText("Sign in with the organization SSO")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in with SSO" })).toBeEnabled();
    expect(screen.getByText(/Need access\?/)).toBeInTheDocument();
  });

  it("FR-2, FR-9: Contact your administrator is a mailto to the admin contacts, plain text when there are none", async () => {
    show("", ["a@zs.com", "b@zs.com"]);
    expect(await screen.findByRole("link", { name: "Contact your administrator" })).toHaveAttribute("href", "mailto:a@zs.com,b@zs.com");
  });

  it("FR-2: without admin contacts there is no link", async () => {
    const fetchMock = show();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByText("Contact your administrator")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Contact your administrator" })).not.toBeInTheDocument();
  });

  it("FR-3: the button goes to the SSO login with the requested path and shows Signing in...", () => {
    sessionStorage.setItem("nervecenter_requested_path", "/tickets/42");
    show();
    fireEvent.click(screen.getByRole("button", { name: "Sign in with SSO" }));
    expect(leavePageTo).toHaveBeenCalledWith(`${authBase}/login?redirect=${encodeURIComponent("/tickets/42")}`);
    const pressed = screen.getByRole("button", { name: "Signing in..." });
    expect(pressed).toBeDisabled();
  });

  it("FR-3: never sends the login page itself as the redirect", () => {
    sessionStorage.setItem("nervecenter_requested_path", "/login?error=x");
    show();
    fireEvent.click(screen.getByRole("button", { name: "Sign in with SSO" }));
    expect(leavePageTo).toHaveBeenCalledWith(`${authBase}/login?redirect=${encodeURIComponent("/")}`);
  });

  it("FR-5: shows the SSO error description, or the code, above the button", () => {
    show("?error=access_denied&error_description=Not%20registered");
    expect(screen.getByRole("alert")).toHaveTextContent("Not registered");
    expect(screen.getByRole("button", { name: "Sign in with SSO" })).toBeEnabled();
  });

  it("FR-5: falls back to Authentication failed: <code>", () => {
    show("?error=access_denied");
    expect(screen.getByRole("alert")).toHaveTextContent("Authentication failed: access_denied");
  });

  it("FR-6: defaults to light, toggles to dark, and leaves the app theme alone", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    show();
    fireEvent.click(screen.getByRole("button", { name: "Switch to dark theme" }));
    expect(screen.getByRole("button", { name: "Switch to light theme" })).toBeInTheDocument();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.length).toBe(0);
  });

  it("FR-8: calls no /api route except /api/meta", async () => {
    const fetchMock = show("?error=x");
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Sign in with SSO" }));
    const urls = fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => url.includes("/api"));
    expect(urls.every((url) => url.endsWith("/api/meta"))).toBe(true);
  });
});

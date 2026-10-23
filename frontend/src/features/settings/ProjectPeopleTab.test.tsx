import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ToastProvider } from "@/components/ui";
import { ProjectPeopleTab } from "./ProjectPeopleTab";
import { jsonResponse, mockFetch, renderWithClient } from "@/test/utils";

// SPEC-projects-03 FR-7, FR-21: everyone in the project sees who is in it; owners change roles.
function serve() {
  const calls: Array<{ url: string; method: string; body: unknown; header: string | null }> = [];
  mockFetch((url, init) => {
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined, header: new Headers(init?.headers).get("X-NerveCenter-Project") });
    if (url.endsWith("/members") && (init?.method ?? "GET") === "GET") return jsonResponse({ items: [{ projectId: "sales", userId: "olga", role: "owner" }, { projectId: "sales", userId: "devi", role: "developer" }] });
    return jsonResponse({});
  });
  return calls;
}
// The members table pages through the URL (SPEC-platform-11), so it renders inside a router.
const show = (canManage: boolean) => renderWithClient(<MemoryRouter><ToastProvider><ProjectPeopleTab projectId="sales" canManage={canManage} /></ToastProvider></MemoryRouter>);

describe("ProjectPeopleTab", () => {
  it("an owner changes someone's role in this project", async () => {
    const calls = serve();
    show(true);
    await userEvent.click(await screen.findByRole("combobox", { name: "Role of devi" }));
    await userEvent.click(await screen.findByRole("option", { name: "Viewer" }));
    await waitFor(() => expect(calls.some((call) => call.method === "PATCH")).toBe(true));
    const patch = calls.find((call) => call.method === "PATCH");
    expect(patch?.url).toMatch(/\/api\/projects\/sales\/members\/devi$/); expect(patch?.body).toEqual({ role: "viewer" }); expect(patch?.header).toBe("sales");
  });

  it("someone who does not run the project reads the people and the roles table only", async () => {
    serve();
    show(false);
    expect(await screen.findByText("devi")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Role of devi" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Add a person" })).not.toBeInTheDocument();
    expect(screen.getByText("People and roles")).toBeInTheDocument();
  });
});

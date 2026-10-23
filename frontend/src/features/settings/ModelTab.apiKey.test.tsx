import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ToastProvider } from "@/components/ui";
import { ProjectContext, type ProjectContextValue } from "@/lib/projectContext";
import { ModelTab } from "./ModelTab";
import { jsonResponse, mockFetch, renderWithClient } from "@/test/utils";

// SPEC-projects-04 FR-8: Settings > Model shows the project's own API key state; app admins set and remove it.
const context = (isGlobalAdmin: boolean): ProjectContextValue => ({ projectId: "sales", slug: "sales", project: null, projects: [], isGlobalAdmin, unrouted: 0, visitor: false, setProject: () => {} });
const KEY = "sk-ant-api03-projectkeyAAAAAAAAAAAAAAAAAA1234";

function serve(status: Record<string, unknown>) {
  return mockFetch((url, init) => {
    const method = init?.method ?? "GET";
    if (url.endsWith("/api/projects/sales/api-key") && method === "PUT") return jsonResponse({ set: true, last4: "1234", setBy: "Admin", setAt: "2026-10-05T00:00:00Z", verified: true });
    if (url.endsWith("/api/projects/sales/api-key")) return jsonResponse(status);
    return jsonResponse({});
  });
}

const show = (isGlobalAdmin: boolean) => renderWithClient(
  <ToastProvider><ProjectContext.Provider value={context(isGlobalAdmin)}><ModelTab operations={{} as never} /></ProjectContext.Provider></ToastProvider>,
);

describe("ModelTab API key", () => {
  it("FR-8: an app admin adds a key; it is sent once and only its last four come back", async () => {
    const fetchMock = serve({ set: false });
    show(true);
    expect(await screen.findByText("No key")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Add key"), { target: { value: KEY } });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));
    expect(await screen.findByText("1234")).toBeInTheDocument();
    const put = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith("/api/projects/sales/api-key") && init?.method === "PUT");
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({ apiKey: KEY });
    expect(new Headers(put?.[1]?.headers).get("X-NerveCenter-Project")).toBe("sales");
    await waitFor(() => expect(screen.getByLabelText("Replace key")).toHaveValue(""));
  });

  it("FR-8: anyone else sees the state read-only", async () => {
    serve({ set: true, last4: "9876", setBy: "Admin", setAt: "2026-10-05T00:00:00Z" });
    show(false);
    expect(await screen.findByText("9876")).toBeInTheDocument();
    expect(screen.getByText("Only an app admin can add or change it.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save key" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });
});

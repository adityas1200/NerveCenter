import { fireEvent, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TicketsPage } from "@/features/tickets/TicketsPage";
import { AgentPanelProvider } from "@/components/ops/AgentPanel";
import { ToastProvider } from "@/components/ui";
import { jsonResponse, meResponse, mockFetch, renderWithClient, testUsers } from "@/test/utils";

// SPEC-projects-02 FR-20..FR-22: the private badge, and the toggle for the people allowed to flip it.
const ticket = {
  ticketId: "OPS-1010", appStatus: "open", sourceStatus: "New", source: "manual", title: "Territory report shows duplicate HCPs", priority: "high", status: "open", category: "task",
  createdAt: "2026-10-03T07:20:00Z", updatedAt: "2026-10-03T08:15:00Z", agent: { state: "none", label: "Not looked at", summary: null, taskId: null }, links: [], recurrence: null,
  creator: { id: "someone.else", name: "Someone" }, assignee: null, visibility: "private",
};

function renderTicket(role: string) {
  const fetchMock = mockFetch((path, init) => {
    if (path.startsWith("/api/me")) return meResponse(testUsers.demo, role);
    if (path === "/api/tickets/OPS-1010" && init?.method === "PATCH") return jsonResponse({ ...ticket, visibility: "project" });
    if (path === "/api/tickets/OPS-1010") return jsonResponse(ticket);
    if (path.startsWith("/api/tickets?")) return jsonResponse({ items: [ticket] });
    return jsonResponse({ items: [] });
  });
  renderWithClient(<MemoryRouter initialEntries={["/tickets/OPS-1010"]}><ToastProvider><AgentPanelProvider><Routes><Route path="/tickets/:ticketId" element={<TicketsPage />} /></Routes></AgentPanelProvider></ToastProvider></MemoryRouter>);
  return fetchMock;
}

describe("ticket visibility", () => {
  it("shows the private badge, and an admin makes the ticket project-wide", async () => {
    const fetchMock = renderTicket("admin");
    expect(await screen.findByText("Private")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "Private ticket" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => url === "/api/tickets/OPS-1010" && init?.method === "PATCH" && String(init.body).includes('"visibility":"project"'))).toBe(true));
  });

  it("hides the toggle from someone who is neither on the ticket nor an admin", async () => {
    renderTicket("developer");
    expect(await screen.findByText("Private")).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Private ticket" })).not.toBeInTheDocument();
  });
});

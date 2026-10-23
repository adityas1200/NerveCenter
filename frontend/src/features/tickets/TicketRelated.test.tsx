import { screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TicketsPage } from "@/features/tickets/TicketsPage";
import { AgentPanelProvider } from "@/components/ops/AgentPanel";
import { ToastProvider } from "@/components/ui";
import { jsonResponse, meResponse, mockFetch, renderWithClient, testUsers } from "@/test/utils";

const ticket = {
  ticketId: "OPS-1010", appStatus: "open", sourceStatus: "New", source: "manual", title: "Territory report shows duplicate HCPs", priority: "high", status: "open", category: "task",
  createdAt: "2026-10-03T07:20:00Z", updatedAt: "2026-10-03T08:15:00Z", agent: { state: "none", label: "Not looked at", summary: null, taskId: null },
  links: [{ relation: "recurrence_of", direction: "out", ticketId: "OPS-1002", auto: true }, { relation: "related_to", direction: "in", ticketId: "OPS-1004" }],
  recurrence: { ofTicketId: "OPS-1002", auto: true },
};

function renderTicket(detail: unknown) {
  mockFetch((path) => {
    if (path.startsWith("/api/me")) return meResponse(testUsers.demo, "admin");
    if (path === "/api/tickets/OPS-1010") return jsonResponse(detail);
    if (path.startsWith("/api/tickets?")) return jsonResponse({ items: [detail] });
    return jsonResponse({ items: [] });
  });
  return renderWithClient(<MemoryRouter initialEntries={["/tickets/OPS-1010"]}><ToastProvider><AgentPanelProvider><Routes><Route path="/tickets/:ticketId" element={<TicketsPage />} /></Routes></AgentPanelProvider></ToastProvider></MemoryRouter>);
}

describe("ticket links", () => {
  it("shows a recurrence badge and the related tickets with their relation", async () => {
    renderTicket(ticket);
    const badge = await screen.findByRole("link", { name: /Recurrence of OPS-1002/ });
    expect(badge).toHaveAttribute("href", "/tickets/OPS-1002");
    const related = within(screen.getByText("Related tickets").closest("section") as HTMLElement);
    expect(related.getByText("Recurrence of")).toBeInTheDocument();
    expect(related.getByRole("link", { name: "OPS-1002" })).toHaveAttribute("href", "/tickets/OPS-1002");
    expect(related.getByText("Related to")).toBeInTheDocument();
    expect(related.getByRole("link", { name: "OPS-1004" })).toBeInTheDocument();
  });

  it("shows neither when the ticket has no links", async () => {
    renderTicket({ ...ticket, links: [], recurrence: null });
    await screen.findByText("Sonic has not looked at this yet");
    expect(screen.queryByText("Related tickets")).not.toBeInTheDocument();
    expect(screen.queryByText(/Recurrence of OPS/)).not.toBeInTheDocument();
  });
});

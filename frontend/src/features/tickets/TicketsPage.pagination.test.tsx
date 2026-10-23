import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TicketsPage } from "./TicketsPage";
import { AgentPanelProvider } from "@/components/ops/AgentPanel";
import { ToastProvider } from "@/components/ui";
import { jsonResponse, meResponse, mockFetch, renderWithClient, testUsers } from "@/test/utils";

const meta = { open: 12, highOpen: 0, waitingOnYou: 0, closed: 0, resolved: 0, scoped: 12,
  options: { priority: ["medium"], status: ["open"], assignee: [], source: ["manual"] }, people: [] };
const row = (n: number) => ({ ticketId: `OPS-${n}`, title: `Ticket ${n}`, status: "open", appStatus: "open", priority: "medium", source: "manual", createdAt: "2026-10-11T00:00:00.000Z" });
const renderPage = (path: string) => renderWithClient(<MemoryRouter initialEntries={[path]}><ToastProvider><AgentPanelProvider><Routes><Route path="/tickets" element={<TicketsPage />} /></Routes></AgentPanelProvider></ToastProvider></MemoryRouter>);

describe("TicketsPage server pagination", () => {
  it("SPEC-platform-11 FR-2/FR-3 loads the linked page, uses the server total, and requests the next page", async () => {
    const offsets: number[] = [];
    mockFetch((path) => {
      if (path.startsWith("/api/me")) return meResponse(testUsers.demo, "admin");
      if (path.startsWith("/api/tickets?")) {
        const params = new URLSearchParams(path.split("?")[1]);
        const offset = Number(params.get("offset")); offsets.push(offset);
        expect(params.get("limit")).toBe("10");
        expect(params.get("sort")).toBe("priority");
        expect(params.get("priority")).toBe("all");
        return jsonResponse({ items: offset === 0 ? Array.from({length:10},(_,n)=>row(n)) : [row(10),row(11)], total:12, meta });
      }
      if (path.includes("/api/integrations/servicenow/status") || path.includes("/api/integrations/jira/status")) return jsonResponse({configured:true,ready:true});
      return jsonResponse({items:[]});
    });
    renderPage("/tickets?page=2");
    expect(await screen.findByText("Ticket 10")).toBeInTheDocument();
    expect(screen.queryByText("Ticket 0")).not.toBeInTheDocument();
    expect(screen.getByText("11–12 of 12 tickets")).toBeInTheDocument();
    expect(offsets).toContain(10);
    await userEvent.click(screen.getByRole("button",{name:"Previous page"}));
    expect(await screen.findByText("Ticket 0")).toBeInTheDocument();
    await waitFor(()=>expect(offsets).toContain(0));
  });

  it("SPEC-tickets-05 FR-1 shows a server failure", async () => {
    mockFetch((path) => {
      if (path.startsWith("/api/me")) return meResponse(testUsers.demo,"admin");
      if (path.startsWith("/api/tickets?")) return jsonResponse({error:"Ticket query failed"},500);
      return jsonResponse({configured:true,ready:true});
    });
    renderPage("/tickets");
    expect(await screen.findByText(/Ticket query failed/)).toBeInTheDocument();
  });

  it("SPEC-platform-11 FR-2 clamps a linked page after the server reports a smaller total", async () => {
    const offsets: number[] = [];
    mockFetch((path) => {
      if (path.startsWith("/api/me")) return meResponse(testUsers.demo, "admin");
      if (path.startsWith("/api/tickets?")) {
        const offset = Number(new URLSearchParams(path.split("?")[1]).get("offset")); offsets.push(offset);
        return jsonResponse({items:offset === 10 ? [row(10),row(11)] : [],total:12,meta});
      }
      return jsonResponse({configured:true,ready:true});
    });
    renderPage("/tickets?page=99");
    expect(await screen.findByText("Ticket 10")).toBeInTheDocument();
    expect(offsets).toContain(980);
    expect(offsets).toContain(10);
    expect(screen.getByText("11–12 of 12 tickets")).toBeInTheDocument();
  });
});

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import { ToastProvider } from "@/components/ui";
import { AgentPanelProvider } from "@/components/ops/AgentPanel";
import type { InboxItem } from "@/api/inbox";
import type { Task } from "@/api/tasks";
import { InboxPage } from "@/features/inbox/InboxPage";
import { TasksPage } from "@/features/tasks/TasksPage";
import { jsonResponse, meResponse, mockFetch, renderWithClient, testUsers } from "@/test/utils";

const makeTask = (index: number): Task => ({
  id: `T-${index}`,
  type: "adhoc",
  title: `Task ${index}`,
  summary: "",
  status: "done",
  permission: "policy",
  context: { page: { name: "Tasks", path: "/tasks" } },
  createdBy: { id: "demo", name: "Demo" },
  createdAt: `2026-10-${String(index).padStart(2, "0")}T00:00:00Z`,
  updatedAt: `2026-10-${String(index).padStart(2, "0")}T00:00:00Z`,
  cost: { totalUsd: 0, inputTokens: 0, outputTokens: 0, turns: 0, durationMs: 0, runs: 0 },
});

function makeApproval(index: number): InboxItem {
  return { id: `I-${index}`, kind: "approval", status: "pending", taskId: `T-${index}`, title: `Waiting for approval: Change ${index}`, category: "default_write", categoryLabel: "Change", detail: "Review this change", createdAt: "2026-10-11T00:00:00Z", updatedAt: "2026-10-11T00:00:00Z" };
}

describe("CR-02 list paging and Inbox selection", () => {
  it("requests and renders a Tasks page beyond the first server page", async () => {
    const all = Array.from({ length: 12 }, (_, index) => makeTask(index + 1));
    const requests: string[] = [];
    mockFetch((url) => {
      requests.push(url);
      if (url.includes("/api/tasks")) {
        const params = new URL(url, "http://localhost").searchParams;
        const offset = Number(params.get("offset"));
        const limit = Number(params.get("limit"));
        return jsonResponse({ items: all.slice(offset, offset + limit), total: all.length, active: 0, waiting: 0 });
      }
      return jsonResponse({ items: [] });
    });

    renderWithClient(<MemoryRouter initialEntries={["/tasks?page=2&size=10"]}><ToastProvider><AgentPanelProvider><TasksPage /></AgentPanelProvider></ToastProvider></MemoryRouter>);

    expect(await screen.findByRole("button", { name: "Task 11" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Task 12" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Task 1" })).not.toBeInTheDocument();
    expect(requests.some((request) => new URL(request, "http://localhost").searchParams.get("offset") === "10")).toBe(true);
  });

  it("keeps explicit approval selection across pages, retains only unfinished items after a failure, and marks the full scope read", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const items = [...Array.from({ length: 10 }, (_, index) => makeApproval(index + 1)), makeApproval(11)];
    const calls: string[] = [];
    mockFetch((url, init) => {
      calls.push(`${init?.method || "GET"} ${url}`);
      if (url.endsWith("/api/me")) return meResponse(testUsers.admin, "admin");
      if (url.endsWith("/api/inbox/read-all")) return jsonResponse({ updated: 11 });
      if (url.includes("/api/inbox/I-1/approve")) return jsonResponse({ ...items[0], status: "approved" });
      if (url.includes("/api/inbox/I-11/approve")) return jsonResponse({ message: "This approval was already denied." }, 409);
      if (url.includes("/api/inbox/")) return jsonResponse({});
      if (url.includes("/api/inbox?")) {
        const params = new URL(url, "http://localhost").searchParams;
        const offset = Number(params.get("offset"));
        const limit = Number(params.get("limit"));
        const filtered = params.get("view") === "needs_action" ? items : items;
        return jsonResponse({ items: filtered.slice(offset, offset + limit), total: filtered.length, pending: 11, approvals: 11, unread: 11 });
      }
      if (url.includes("/api/tasks")) return jsonResponse({ items: [], total: 0, active: 0, waiting: 0 });
      return jsonResponse({ items: [] });
    });
    renderWithClient(<MemoryRouter><ToastProvider><InboxPage /></ToastProvider></MemoryRouter>);

    await userEvent.click(await screen.findByRole("checkbox", { name: "Select approval Change 1" }));
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select approval Change 11" }));
    await userEvent.click(screen.getByRole("button", { name: "Approve selected (2)" }));

    expect(await screen.findByText(/Approved 1 of 2/)).toBeInTheDocument();
    expect(screen.getByText("1 selected across pages")).toBeInTheDocument();
    expect(calls.some((call) => call.startsWith("POST /api/inbox/I-1/approve"))).toBe(true);
    expect(calls.some((call) => call.startsWith("POST /api/inbox/I-11/approve"))).toBe(true);

    await userEvent.click(await screen.findByRole("button", { name: "Mark all read" }));
    await waitFor(() => expect(calls.some((call) => call === "POST /api/inbox/read-all")).toBe(true));
  });
});

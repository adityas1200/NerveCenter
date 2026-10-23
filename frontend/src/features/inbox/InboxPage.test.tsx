import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "@/components/ui";
import type { InboxItem } from "@/api/inbox";
import { InboxPage } from "./InboxPage";
import { jsonResponse, meResponse, mockFetch, renderWithClient, testUsers } from "@/test/utils";

const items: InboxItem[] = [
  { id: "I-1", kind: "approval", status: "pending", taskId: "T-1040", title: "Waiting for approval: snowflake · grant Role ANALYST_RO", category: "privileged_access", categoryLabel: "Access change", detail: "Snowflake read access · the agent wants to make this change", tool: { name: "mcp__snowflake__grant_role", input: JSON.stringify({ role: "ANALYST_RO", user: "R_MEHTA" }) }, createdAt: "2026-09-24T08:00:00Z", updatedAt: "2026-09-24T08:00:00Z" },
  { id: "I-2", kind: "question", status: "pending", taskId: "T-1043", title: "Backfill the 1,200 HCP records in dev first, or straight to prod?", detail: "HCP master sync · the agent paused for your answer", createdAt: "2026-09-24T07:30:00Z", updatedAt: "2026-09-24T07:30:00Z" },
  { id: "I-3", kind: "notification", status: "pending", taskId: "T-1041", title: "Daily ticket review finished", detail: "7 actionable tickets · 1 SLA risk", createdAt: "2026-09-24T07:00:00Z", updatedAt: "2026-09-24T07:00:00Z" },
  { id: "I-4", kind: "approval", status: "approved", taskId: "T-1039", title: "Publish weekly report", detail: "SharePoint", decidedBy: { id: "mitesh", name: "Mitesh" }, createdAt: "2026-09-23T16:00:00Z", updatedAt: "2026-09-23T16:12:00Z" },
];

describe("InboxPage", () => {
  it("opens on what needs action, labels approvals by policy category, and approving posts the decision", async () => {
    const calls: string[] = [];
    mockFetch((url, init) => { calls.push(`${init?.method || "GET"} ${url}`); if (url.includes("/api/me")) return meResponse(testUsers.demo, "admin"); if (url.includes("/api/inbox/I-1/approve")) return jsonResponse({ ...items[0], status: "approved" }); if (url.includes("/api/inbox/read-all")) return jsonResponse({ updated: 1 }); if (url.includes("/api/inbox")) { const page = url.includes("view=needs_action") ? items.slice(0, 2) : items; return jsonResponse({ items: page, total: page.length, pending: 2, approvals: 1, unread: 1 }); } return jsonResponse({ items: [] }); });
    renderWithClient(<MemoryRouter><ToastProvider><InboxPage /></ToastProvider></MemoryRouter>);
    expect(await screen.findByText("snowflake · grant Role ANALYST_RO")).toBeInTheDocument();
    expect(screen.queryByText(/need your decision/)).not.toBeInTheDocument();
    expect(screen.getByText("Access change")).toBeInTheDocument();
    expect(screen.getByText("Question")).toBeInTheDocument();
    expect(screen.queryByText("Daily ticket review finished")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Answer" })).toHaveAttribute("href", "/tasks/T-1043");
    // The approval's inputs are open before anyone decides, and the row links to the task.
    expect(screen.getByText("ANALYST_RO")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "snowflake · grant Role ANALYST_RO" })).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByRole("link", { name: /T-1040/ })).toHaveAttribute("href", "/tasks/T-1040");
    const markAll = screen.getByRole("button", { name: "Mark all read" });
    expect(markAll.closest("[data-list-toolbar]")).toContainElement(screen.getByRole("tablist", { name: "Inbox filter" }));
    fireEvent.click(screen.getByRole("button", { name: /^Approve$/ }));
    await waitFor(() => expect(calls.some((call) => call === "POST /api/inbox/I-1/approve")).toBe(true));
    await userEvent.click(screen.getByRole("tab", { name: /All/ }));
    expect(await screen.findByText("Daily ticket review finished")).toBeInTheDocument();
    expect(screen.getByText("Update")).toBeInTheDocument();
    // A settled row is one line with a short status; who decided shows once the row is opened.
    expect(screen.getAllByText("Approved").length).toBeGreaterThan(0);
    expect(screen.queryByText(/approved by Mitesh/)).not.toBeInTheDocument();
    for (const button of screen.getAllByTitle("Show details")) await userEvent.click(button);
    expect(screen.getByText(/approved by Mitesh/)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /T-1041|T-1039/ }).map((link) => link.getAttribute("href"))).toEqual(["/tasks/T-1041", "/tasks/T-1039"]);
    await userEvent.click(markAll);
    await waitFor(() => expect(calls.some((call) => call === "POST /api/inbox/read-all")).toBe(true));
  });

  it("answers a question with options in place, keeps legacy questions on the task, and reads answers back in Done", async () => {
    const questions = [{ question: "Which period should the report cover?", header: "Period", multiSelect: false, options: [{ label: "Last 7 days", description: "Monday to Sunday" }, { label: "Last 30 days" }] }];
    const structured: InboxItem = { id: "Q-1", kind: "question", status: "pending", taskId: "T-1050", title: "Which period should the report cover?", detail: "Weekly report · Sonic paused for your answer", questions, createdAt: "2026-09-25T09:00:00Z", updatedAt: "2026-09-25T09:00:00Z" };
    const answered: InboxItem = { ...structured, id: "Q-0", status: "answered", answers: { "Which period should the report cover?": "Last 30 days" }, decidedBy: { id: "mitesh", name: "Mitesh" } };
    const skipped: InboxItem = { ...structured, id: "Q-2", status: "denied", decidedBy: { id: "mitesh", name: "Mitesh" } };
    const calls: Array<{ call: string; body: unknown }> = [];
    mockFetch((url, init) => { calls.push({ call: `${init?.method || "GET"} ${url}`, body: init?.body ? JSON.parse(String(init.body)) : null }); if (url.includes("/api/inbox/Q-1/answer")) return jsonResponse({ ...structured, status: "answered" }); if (url.includes("/api/inbox")) { const page = url.includes("view=done") ? [answered, skipped] : [structured, items[1]]; return jsonResponse({ items: page, total: page.length, pending: 2, approvals: 0, unread: 0 }); } return jsonResponse({ items: [] }); });
    renderWithClient(<MemoryRouter><ToastProvider><InboxPage /></ToastProvider></MemoryRouter>);
    // The form is open without a click; the legacy question still points at the task.
    expect(await screen.findByRole("button", { name: "Send answers" })).toBeDisabled();
    expect(screen.getByText("Monday to Sunday")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Answer" })).toHaveLength(1);
    await userEvent.click(screen.getByRole("radio", { name: /Last 7 days/ }));
    await userEvent.click(screen.getByRole("button", { name: "Send answers" }));
    await waitFor(() => expect(calls.find((entry) => entry.call === "POST /api/inbox/Q-1/answer")?.body).toEqual({ answers: { "Which period should the report cover?": "Last 7 days" } }));
    expect(await screen.findByText("Last 7 days")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Done" }));
    // Settled rows are one line ("Answered", "Skipped"); opening a row shows the answer and who gave it.
    expect(await screen.findByText("Answered")).toBeInTheDocument();
    expect(screen.queryByText(/^Answered:/)).not.toBeInTheDocument();
    for (const button of screen.getAllByTitle("Show details")) await userEvent.click(button);
    expect(await screen.findByText("Last 30 days")).toBeInTheDocument();
    expect(screen.getAllByText("Skipped").length).toBeGreaterThan(0);
    expect(screen.getByText(/answered by Mitesh/)).toBeInTheDocument();
    expect(screen.getByText(/skipped by Mitesh/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send answers" })).not.toBeInTheDocument();
  });
});

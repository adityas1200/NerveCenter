import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Task, TaskEvent } from "@/api/tasks";
import { AgentPanelProvider } from "@/components/ops/AgentPanel";
import { ToastProvider } from "@/components/ui";
import { jsonResponse, meResponse, mockFetch, renderWithClient, sseResponse, testUsers } from "@/test/utils";
import { TaskPage } from "./TaskPage";

// SPEC-tasks-10 FR-3, FR-4, FR-5, S3: the Details sheet, where a task opens, and acting from the thread.
const task: Task = { id: "T-1043", type: "routine", title: "Weekly monitor", summary: "Email sent", status: "done", permission: "policy", context: {}, createdBy: { id: "system", name: "NerveCenter" }, createdAt: "2026-10-06T22:35:00Z", updatedAt: "2026-10-06T22:40:00Z", cost: { totalUsd: 0, inputTokens: 0, outputTokens: 0, turns: 1, durationMs: 1000, runs: 1 }, pendingApprovalId: null };
const events: TaskEvent[] = [
  { id: "u1", taskId: "T-1043", seq: 1, at: "2026-10-06T22:35:00Z", type: "user.message", text: "Check the weekly field execution data" },
  { id: "t1", taskId: "T-1043", seq: 2, at: "2026-10-06T22:36:00Z", type: "tool.use", toolUseId: "tu1", name: "mcp__nervecenter__show_actions", input: JSON.stringify({ items: [{ label: "Rerun the check", kind: "ask", prompt: "Rerun the weekly check now" }], questions: ["Who owns the feed?"] }) },
  { id: "a1", taskId: "T-1043", seq: 3, at: "2026-10-06T22:40:00Z", type: "assistant.text", text: "The failure email went to the owner." },
];
const files = ["email.html", "report.md"].map((name) => ({ name, path: name, type: "file", size: 100 }));

function open(current: Task, sent: string[] = []) {
  mockFetch((url, init) => {
    if (url.includes("/api/me")) return meResponse(testUsers.demo, "developer");
    if (url.endsWith("/api/tasks/T-1043/messages") && init?.method === "POST") { sent.push(JSON.parse(String(init.body)).text); return jsonResponse({ ...current, queued: false }); }
    if (url.endsWith("/api/tasks/T-1043")) return jsonResponse({ ...current, events });
    if (url.endsWith("/api/tasks/T-1043/files")) return jsonResponse({ id: "T-1043", items: files });
    if (url.includes("/api/tasks/T-1043/events")) return sseResponse();
    return jsonResponse({ items: [] });
  });
  return renderWithClient(<MemoryRouter initialEntries={["/tasks/T-1043"]}><ToastProvider><AgentPanelProvider><Routes><Route path="/tasks/:taskId" element={<TaskPage />} /></Routes></AgentPanelProvider></ToastProvider></MemoryRouter>);
}

describe("Task page", () => {
  const scrollTo = vi.fn();
  // jsdom lays nothing out: give the thread a height so its bottom is not its top.
  beforeEach(() => { scrollTo.mockClear(); Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: scrollTo }); Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get: () => 900 }); });
  afterEach(() => { delete (HTMLElement.prototype as Partial<HTMLElement>).scrollTo; delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight; });

  it("FR-3: the files are in the Details sheet, not in the thread", async () => {
    open(task);
    expect(await screen.findByText("The failure email went to the owner.")).toBeInTheDocument();
    expect(screen.queryByTitle("report.md")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Details" }));
    const sheet = await screen.findByRole("dialog");
    expect(await within(within(sheet).getByRole("region", { name: "Files" })).findByTitle("report.md")).toBeInTheDocument();
    expect(within(sheet).getByRole("region", { name: "Changes" })).toBeInTheDocument();
    expect(within(sheet).queryByText("Cost")).not.toBeInTheDocument();
  });

  it("FR-4: a finished task opens at the top of the thread, a live one at its end", async () => {
    const { unmount } = open(task);
    await screen.findByText("The failure email went to the owner.");
    await waitFor(() => expect(scrollTo).toHaveBeenLastCalledWith({ top: 0 }));
    unmount();
    scrollTo.mockClear();
    open({ ...task, status: "running" });
    await screen.findByText("Check the weekly field execution data");
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 900 })));
    expect(scrollTo).not.toHaveBeenCalledWith({ top: 0 });
  });

  it("FR-5, S3: the follow-up chips and the actions send their text as the reader's message", async () => {
    const sent: string[] = [];
    open(task, sent);
    await userEvent.click(await screen.findByRole("button", { name: "Who owns the feed?" }));
    await waitFor(() => expect(sent).toEqual(["Who owns the feed?"]));
    await userEvent.click(screen.getByRole("button", { name: /Rerun the check/ }));
    await waitFor(() => expect(sent).toEqual(["Who owns the feed?", "Rerun the weekly check now"]));
  });

  it("FR-5, FR-18: a live task offers no follow-ups and its actions wait", async () => {
    open({ ...task, status: "running" });
    await screen.findByText("Check the weekly field execution data");
    expect(screen.queryByRole("list", { name: "Suggested questions" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Rerun the check/ })).toBeDisabled();
  });
});

import { screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Task, TaskEvent } from "@/api/tasks";
import { AgentPanelProvider } from "@/components/ops/AgentPanel";
import { ToastProvider } from "@/components/ui";
import { jsonResponse, meResponse, mockFetch, renderWithClient, sseResponse, testUsers } from "@/test/utils";
import { TaskPage } from "./TaskPage";

// SPEC-knowledge-03 FR-8: a knowledge setup task opens on its Interview guide tab; other tasks have no such tab.
const base: Task = { id: "T-31", type: "adhoc", title: "Knowledge setup", summary: "", status: "done", permission: "policy", context: { knowledgeSetup: true, knowledgeBase: "team-knowledge" }, createdBy: { id: "owner", name: "Olivia" }, createdAt: "2026-10-13T09:00:00Z", updatedAt: "2026-10-13T09:10:00Z", cost: { totalUsd: 0, inputTokens: 0, outputTokens: 0, turns: 1, durationMs: 1000, runs: 1 }, pendingApprovalId: null };
const events: TaskEvent[] = [
  { id: "u1", taskId: "T-31", seq: 1, at: "2026-10-13T09:00:00Z", type: "user.message", text: "Set up this project's knowledge." },
  { id: "a1", taskId: "T-31", seq: 2, at: "2026-10-13T09:10:00Z", type: "assistant.text", text: "Drafted 6 pages and 12 questions." },
];
const guide = { updatedAt: null, questions: [{ id: "G-1", theme: "Sales load", question: "Why was INC-4821 fixed by hand?", why: "", evidence: [], audience: "Ops lead", priority: "high", status: "open", answer: "", cites: [], pages: [], round: 1, updatedAt: null }] };

function open(task: Task, urls: string[] = []) {
  window.localStorage.setItem("nervecenter.task.panel", "1");
  mockFetch((url) => {
    urls.push(url);
    if (url.includes("/api/me")) return meResponse(testUsers.demo, "developer");
    if (url.endsWith("/api/tasks/T-31")) return jsonResponse({ ...task, events });
    if (url.endsWith("/api/tasks/T-31/interview-guide")) return jsonResponse(guide);
    if (url.endsWith("/api/tasks/T-31/files")) return jsonResponse({ id: "T-31", items: [] });
    if (url.includes("/api/tasks/T-31/events")) return sseResponse();
    if (url.endsWith("/api/knowledge")) return jsonResponse({ items: [], mcp: { mode: "local", connection: "", collections: [] } });
    return jsonResponse({ items: [] });
  });
  return renderWithClient(<MemoryRouter initialEntries={["/tasks/T-31"]}><ToastProvider><AgentPanelProvider><Routes><Route path="/tasks/:taskId" element={<TaskPage />} /></Routes></AgentPanelProvider></ToastProvider></MemoryRouter>);
}

describe("Knowledge setup task page", () => {
  beforeEach(() => { Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() }); });
  afterEach(() => { delete (HTMLElement.prototype as Partial<HTMLElement>).scrollTo; window.localStorage.clear(); });

  it("opens the side panel on the interview guide", async () => {
    open(base);
    const panel = await screen.findByRole("tabpanel", { name: "Interview guide" });
    expect(await within(panel).findByText("Why was INC-4821 fixed by hand?")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Guide/ })).toHaveAttribute("aria-selected", "true");
  });

  it("an ordinary task has no Guide tab and never asks for a guide", async () => {
    const urls: string[] = [];
    open({ ...base, context: {} }, urls);
    expect(await screen.findByText("Drafted 6 pages and 12 questions.")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Guide/ })).toBeNull();
    expect(urls.some((url) => url.includes("interview-guide"))).toBe(false);
  });
});

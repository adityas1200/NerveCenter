import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { ToastProvider } from "@/components/ui";
import { AgentPanelProvider } from "@/components/ops/AgentPanel";
import { NewTaskPage } from "./NewTaskPage";
import { TaskPage } from "./TaskPage";
import { TaskThread } from "./TaskThread";
import { TasksPage } from "./TasksPage";
import { groupEvents, artifactsFrom } from "./taskEvents";
import { skillsUsed } from "./taskUsage";
import type { Task, TaskEvent } from "@/api/tasks";
import { jsonResponse, meResponse, mockFetch, renderWithClient, sseResponse, testUsers } from "@/test/utils";


const base: Task = { id: "T-1001", type: "ticket", title: "Investigate customer_daily_refresh failure", summary: "Comparing last good and first bad run", status: "waiting", permission: "ask", context: { ticket: { ticketId: "OPS-1001", priority: "critical", status: "open", source: "servicenow", externalReference: { number: "INC0012345", url: "https://example.service-now.com/x" } } }, createdBy: { id: "demo.user", name: "Demo User" }, createdAt: "2026-09-24T09:14:00Z", updatedAt: "2026-09-24T09:15:00Z", sessionId: "sess-1", cost: { totalUsd: 0.42, inputTokens: 1200, outputTokens: 300, turns: 2, durationMs: 5000, runs: 1 }, pendingApprovalId: "I-1" };
const adhoc: Task = { ...base, id: "T-1002", type: "adhoc", title: "Weekly report", summary: "Workbook and deck ready", status: "done", pendingApprovalId: null, context: { page: { name: "Overview", path: "/" } } };
const events: TaskEvent[] = [
  { id: "e1", taskId: "T-1001", seq: 1, at: "2026-09-24T09:14:00Z", type: "user.message", text: "Investigate the failure", actor: { id: "demo.user", name: "Demo User" } },
  { id: "e2", taskId: "T-1001", seq: 2, at: "2026-09-24T09:14:05Z", type: "session.init", model: "claude", tools: 12, skills: ["operations-fleet:rca"], mcpServers: [{ name: "databricks", status: "connected" }], plugins: ["operations-fleet"] },
  { id: "e3", taskId: "T-1001", seq: 3, at: "2026-09-24T09:14:10Z", type: "assistant.text", text: "I'll compare the last good run with the first bad one." },
  { id: "e4", taskId: "T-1001", seq: 4, at: "2026-09-24T09:14:12Z", type: "tool.use", toolUseId: "tu1", name: "Skill", title: "Skill", input: JSON.stringify({ skill: "operations-fleet:rca" }) },
  { id: "e5", taskId: "T-1001", seq: 5, at: "2026-09-24T09:14:13Z", type: "tool.result", toolUseId: "tu1", content: "ok" },
  { id: "e6", taskId: "T-1001", seq: 6, at: "2026-09-24T09:14:20Z", type: "tool.use", toolUseId: "tu2", name: "Write", title: "Write file", input: JSON.stringify({ file_path: "tasks/T-1001/rca.md", content: "# RCA" }) },
  { id: "e7", taskId: "T-1001", seq: 7, at: "2026-09-24T09:14:21Z", type: "tool.result", toolUseId: "tu2", content: "written" },
  { id: "e8", taskId: "T-1001", seq: 8, at: "2026-09-24T09:15:00Z", type: "approval.requested", inboxId: "I-1", title: "Waiting for approval: atlassian · add Comment To Jira Issue DATAOPS-1854", detail: "Writes to Jira need approval", tool: { name: "mcp__atlassian__addCommentToJiraIssue", input: JSON.stringify({ issueKey: "DATAOPS-1854", body: "RCA summary" }) } },
];

function renderAt(path: string, routes: ReactElement) {
  return renderWithClient(<MemoryRouter initialEntries={[path]}><ToastProvider><AgentPanelProvider><Routes>{routes}</Routes></AgentPanelProvider></ToastProvider></MemoryRouter>);
}

describe("Tasks", () => {
  // The details panel remembers open/closed in localStorage; a test that closes it must not close it for the next.
  afterEach(() => { window.localStorage.clear(); });
  // The Sonic panel body is code-split and loads on first open; compile it once here so a test waits for behaviour, not the bundler.
  beforeAll(() => import("@/components/ops/AgentPanelBody"), 30_000);

  it("groups events into a thread and finds files and skills", () => {
    const groups = groupEvents(events, false);
    expect(groups.map((group) => group.kind)).toEqual(["user", "steps", "assistant", "steps"]);
    expect(artifactsFrom(events)).toEqual([{ path: "tasks/T-1001/rca.md", name: "rca.md", at: "2026-09-24T09:14:20Z" }]);
    expect(skillsUsed(events)).toEqual(["rca"]);
  });

  it("surfaces the SDK's result event as its own group instead of dropping it", () => {
    const result: TaskEvent = { id: "e9", taskId: "T-1001", seq: 9, at: "2026-09-24T09:15:30Z", type: "result", subtype: "success", isError: false, durationMs: 42_000, turns: 6 };
    const groups = groupEvents([...events, result], false);
    expect(groups.at(-1)).toEqual({ kind: "result", event: result });
  });

  it("shows how long a reply took only when it is worth saying, not after a quick one", () => {
    const done: Task = { ...adhoc, status: "done" };
    const reply: TaskEvent = { id: "r1", taskId: done.id, seq: 1, at: "2026-09-24T09:14:00Z", type: "assistant.text", text: "Here is the summary." };
    const long: TaskEvent = { id: "r2", taskId: done.id, seq: 2, at: "2026-09-24T09:14:42Z", type: "result", subtype: "success", isError: false, durationMs: 42_000, turns: 6 };
    const { rerender } = render(<TaskThread task={done} events={[reply, long]} pendingApproval={null} />);
    expect(screen.getByText("42s · 6 turns")).toBeInTheDocument();

    const quick: TaskEvent = { ...long, id: "r3", durationMs: 2_000, turns: 1 };
    rerender(<TaskThread task={done} events={[reply, quick]} pendingApproval={null} />);
    expect(screen.queryByText(/turns/)).not.toBeInTheDocument();
  });

  it("folds a turn's work into one Worked line and opens it into a row per call, files as chips", async () => {
    const done: Task = { ...adhoc, status: "done" };
    const at = "2026-09-24T09:14:00Z";
    const call = (seq: number, name: string, input: Record<string, unknown>): TaskEvent[] => [
      { id: `u${seq}`, taskId: done.id, seq, at, type: "tool.use", toolUseId: `t${seq}`, name, input: JSON.stringify(input) },
      { id: `r${seq}`, taskId: done.id, seq: seq + 0.5, at, type: "tool.result", toolUseId: `t${seq}`, content: "ok" },
    ];
    const steps = [...call(1, "Bash", { command: "ls -la\necho hi" }), ...call(2, "Bash", { command: "git status" }), ...call(3, "Read", { file_path: "tasks/T-1002/notes.md" }), ...call(4, "Write", { file_path: "tasks/T-1002/g11-inout.txt", content: "x" })];
    render(<TaskThread task={done} events={steps} pendingApproval={null} />);
    const toggle = screen.getByRole("button", { name: /^Worked.*4 steps/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    expect(screen.getByText("ls -la")).toBeInTheDocument();
    expect(screen.getByTitle("tasks/T-1002/g11-inout.txt")).toHaveTextContent("g11-inout.txt");
    await userEvent.click(screen.getByRole("button", { name: /^Run git status/ }));
    expect(screen.getByText(/"command":"git status"/)).toBeInTheDocument();
  });

  it("lists tasks with type chips that say who started them; the title carries the row, not a summary", async () => {
    const triage: Task = { ...base, id: "T-1004", title: "Nightly load failed", createdBy: { id: "system", name: "NerveCenter" }, status: "done", pendingApprovalId: null };
    mockFetch((url) => { if (url.includes("/api/tasks")) return jsonResponse({ items: [base, adhoc, triage] }); return jsonResponse({ items: [] }); });
    renderAt("/tasks", <Route path="/tasks" element={<TasksPage />} />);
    expect(await screen.findByRole("button", { name: "Investigate customer_daily_refresh failure" })).toBeInTheDocument();
    // One table: a header row, then every task in the same columns.
    expect(screen.getByRole("columnheader", { name: "Started by" })).toBeInTheDocument();
    expect(screen.getAllByRole("cell", { name: "Ticket" }).length).toBe(2);
    expect(screen.getByRole("cell", { name: "Demo User · from ticket INC0012345" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Automatic triage · INC0012345" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Demo User · Overview" })).toBeInTheDocument();
    expect(screen.queryByText("Workbook and deck ready")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Waiting on you" })).toBeInTheDocument();
    // One vocabulary: the tab and the row chip both say Chat for an ad-hoc task.
    expect(screen.getByRole("tab", { name: "Chat" })).toBeInTheDocument();
    expect(screen.queryByText("Ad-hoc")).not.toBeInTheDocument();
  });

  it("keeps the type filter and search in the URL and says Stopped for a cancelled task", async () => {
    const calls: string[] = [];
    const stopped: Task = { ...adhoc, id: "T-1003", title: "Abandoned export", status: "cancelled" };
    mockFetch((url) => { calls.push(url); if (url.includes("/api/tasks")) { const rows = url.includes("q=Abandoned") ? [stopped] : [adhoc, stopped]; return jsonResponse({ items: rows, total: rows.length, active: 0, waiting: 0 }); } return jsonResponse({ items: [] }); });
    let location: { search: string } = { search: "" };
    const Probe = () => { location = useLocation(); return null; };
    renderAt("/tasks?type=adhoc", <Route path="/tasks" element={<><TasksPage /><Probe /></>} />);
    expect(await screen.findByRole("button", { name: "Abandoned export" })).toBeInTheDocument();
    expect(calls.some((url) => url.includes("/api/tasks?type=adhoc"))).toBe(true);
    expect(screen.getByRole("tab", { name: "Chat" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("img", { name: "Stopped" })).toBeInTheDocument();
    expect(screen.getAllByText("Stopped").length).toBeGreaterThan(0);
    expect(screen.queryByText("Cancelled")).not.toBeInTheDocument();

    await userEvent.type(screen.getByRole("textbox", { name: "Search tasks" }), "Abandoned");
    await waitFor(() => expect(location.search).toBe("?type=adhoc&q=Abandoned"));
    expect(screen.queryByRole("button", { name: "Weekly report" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "All" }));
    await waitFor(() => expect(location.search).toBe("?q=Abandoned"));
  });

  it("archives a task from its row menu, hiding it from the default list, and unarchives it from the Archived view", async () => {
    const calls: Array<{ method: string; url: string; body?: unknown }> = [];
    let archived = false;
    mockFetch((url, init) => {
      const method = init?.method || "GET";
      calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith("/api/tasks/T-1002") && method === "PATCH") { archived = JSON.parse(String(init?.body)).archived; return jsonResponse({ ...adhoc, archived }); }
      if (url.includes("/api/tasks")) return jsonResponse({ items: url.includes("archived=true") ? (archived ? [{ ...adhoc, archived: true }] : []) : (archived ? [] : [adhoc]) });
      return jsonResponse({ items: [] });
    });
    renderAt("/tasks", <Route path="/tasks" element={<TasksPage />} />);
    expect(await screen.findByRole("button", { name: "Weekly report" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Actions for Weekly report" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Archive" }));
    expect(await screen.findByText("Task archived")).toBeInTheDocument();
    const patchCall = calls.find((call) => call.method === "PATCH");
    expect(patchCall?.body).toEqual({ archived: true });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Weekly report" })).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole("tab", { name: "Archived" }));
    expect(await screen.findByRole("button", { name: "Weekly report" })).toBeInTheDocument();
    expect(calls.some((call) => call.method === "GET" && call.url.includes("archived=true"))).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: "Actions for Weekly report" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Restore" }));
    expect(await screen.findByText("Task restored")).toBeInTheDocument();
  });

  it("shows the conversation, the pending approval with Approve and Deny, files and session facts", async () => {
    const calls: string[] = [];
    mockFetch((url, init) => {
      calls.push(`${init?.method || "GET"} ${url}`);
      if (url.includes("/api/me")) return meResponse(testUsers.demo, "admin");
      if (url.endsWith("/api/tasks/T-1001")) return jsonResponse({ ...base, events });
      if (url.includes("/api/tasks/T-1001/events")) return sseResponse([]);
      if (url.endsWith("/api/inbox/I-1/approve") && init?.method === "POST") return jsonResponse({ id: "I-1", status: "approved" });
      return jsonResponse({ items: [] });
    });
    renderAt("/tasks/T-1001", <Route path="/tasks/:taskId" element={<TaskPage />} />);
    expect(await screen.findByText("Investigate the failure")).toBeInTheDocument();
    // SPEC-tasks-10 FR-1, FR-3: one conversation and no view tabs; the only tabs are the details panel's.
    expect(screen.getByRole("tablist", { name: "Task details" })).toBeInTheDocument();
    expect(screen.getAllByRole("tab").map((tab) => tab.getAttribute("title"))).toEqual(["Files", "Changes", "Skills used", "Knowledge used", "Ticket", "Session"]);
    // FR-2: the outcome line says what the task waits on and is a way to it.
    expect(screen.getByRole("button", { name: "Waiting for your approval. Go to it" })).toBeInTheDocument();
    // FR-7: the pending approval is in the turn, and the fold stays shut for it.
    expect(screen.getByText("Sonic needs your approval")).toBeInTheDocument();
    expect(screen.queryByText("I'll compare the last good run with the first bad one.")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^Worked/ }));
    expect(screen.getByText("I'll compare the last good run with the first bad one.")).toBeInTheDocument();
    expect(screen.getByTitle(/^Skill · rca/)).toHaveTextContent(/^Skillrca/);
    expect(screen.getByTitle(/^Wrote T-1001\/rca\.md/)).toHaveTextContent(/^Writerca\.md/);
    // FR-3: files, the ticket and the session facts are in the Details sheet.
    await userEvent.click(screen.getByRole("button", { name: "Details" }));
    const sheet = await screen.findByRole("dialog");
    expect(within(within(sheet).getByRole("region", { name: "Files" })).getByTitle("rca.md")).toBeInTheDocument();
    expect(within(within(sheet).getByRole("region", { name: "Ticket" })).getByText("INC0012345")).toBeInTheDocument();
    expect(within(within(sheet).getByRole("region", { name: "Session" })).getByText("$0.42")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(await screen.findByRole("menuitem", { name: "Logs" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    fireEvent.click(screen.getAllByRole("button", { name: /^Approve$/ })[0]);
    await waitFor(() => expect(calls.some((call) => call === "POST /api/inbox/I-1/approve")).toBe(true));
    expect(await screen.findByText("Approved. Sonic is continuing.")).toBeInTheDocument();
  });

  // SPEC-platform-manual-refresh FR-7, SPEC-tasks-ui FR-7/FR-8: the chat follows the task stream.
  it("streams the reply as a draft from the event stream that starts after the saved events", async () => {
    const running: Task = { ...base, status: "running", pendingApprovalId: null };
    const delta = (data: Record<string, unknown>) => `event: delta
data: ${JSON.stringify({ taskId: "T-1001", at: "2026-09-24T09:16:00Z", parentToolUseId: null, index: 0, ...data })}

`;
    const fetchMock = mockFetch((url) => {
      if (url.includes("/api/me")) return meResponse(testUsers.demo, "developer");
      if (url.endsWith("/api/tasks/T-1001")) return jsonResponse({ ...running, events: events.slice(0, 2) });
      if (url.includes("/api/tasks/T-1001/events")) return sseResponse([
        delta({ kind: "tool", phase: "start", name: "mcp__nervecenter__get_pipeline_runs", title: "NerveCenter · get pipeline runs" }),
        delta({ kind: "text", phase: "start" }),
        delta({ kind: "text", phase: "delta", text: "Looking at the last " }),
        delta({ kind: "text", phase: "delta", text: "two runs now." }),
        // A subagent's text never reaches the thread.
        delta({ kind: "text", phase: "delta", text: "hidden", parentToolUseId: "sub-1" }),
      ]);
      return jsonResponse({ items: [] });
    });
    renderAt("/tasks/T-1001", <Route path="/tasks/:taskId" element={<TaskPage />} />);
    expect(await screen.findByText("Looking at the last two runs now.")).toBeInTheDocument();
    // The draft carries the typing caret while it streams.
    expect(document.querySelector("[data-streaming] [data-caret]")).not.toBeNull();
    expect(screen.queryByText(/hidden/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/Writing the reply/).length).toBeGreaterThan(0);
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls.find((url) => url.includes("/events"))).toContain("after=2");
  });

  // SPEC-platform-manual-refresh FR-8: a dropped stream reconnects with backoff; nothing polls the task.
  it("reconnects a dropped stream with backoff and never re-reads the task in the background", async () => {
    let taskReads = 0;
    let streamOpens = 0;
    mockFetch((url) => {
      if (url.includes("/api/me")) return meResponse(testUsers.demo, "developer");
      if (url.endsWith("/api/tasks/T-1001")) { taskReads += 1; return jsonResponse({ ...base, status: "running", pendingApprovalId: null, events: events.slice(0, 2) }); }
      if (url.includes("/api/tasks/T-1001/events")) { streamOpens += 1; return sseResponse(); }
      return jsonResponse({ items: [] });
    });
    // Timers are faked for the reconnect delays; response bodies still settle on real setImmediate.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const realImmediate = (globalThis as unknown as { setImmediate: (callback: (value: unknown) => void) => void }).setImmediate;
    const settle = async () => { for (let index = 0; index < 20; index += 1) { await vi.advanceTimersByTimeAsync(0); await new Promise((resolve) => realImmediate(resolve)); } };
    const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); await settle(); }); };
    try {
      renderAt("/tasks/T-1001", <Route path="/tasks/:taskId" element={<TaskPage />} />);
      await act(settle);
      expect(taskReads).toBe(1);
      expect(streamOpens).toBe(1);
      await advance(1_999);
      expect(streamOpens).toBe(1);
      await advance(1);
      expect(streamOpens).toBe(2);
      await advance(3_999);
      expect(streamOpens).toBe(2);
      await advance(1);
      expect(streamOpens).toBe(3);
      expect(taskReads).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("draws the plan as a checklist from propose_plan and update_plan, and shows the reason on an approval", async () => {
    const planEvents: TaskEvent[] = [
      events[0],
      { id: "p1", taskId: "T-1001", seq: 2, at: "2026-09-24T09:14:05Z", type: "tool.use", toolUseId: "tp1", name: "mcp__nervecenter__propose_plan", input: JSON.stringify({ title: "Fix the Veltrix load", steps: [{ id: "s1", text: "Read the failed run", kind: "read" }, { id: "s2", text: "Comment on the ticket", kind: "change" }] }) },
      { id: "p2", taskId: "T-1001", seq: 3, at: "2026-09-24T09:14:06Z", type: "tool.result", toolUseId: "tp1", content: "{}" },
      { id: "p3", taskId: "T-1001", seq: 4, at: "2026-09-24T09:14:20Z", type: "tool.use", toolUseId: "tp2", name: "mcp__nervecenter__update_plan", input: JSON.stringify({ stepId: "s1", state: "done", note: "Run 900100826 failed on plan_type." }) },
      { id: "p4", taskId: "T-1001", seq: 5, at: "2026-09-24T09:14:21Z", type: "tool.result", toolUseId: "tp2", content: "{}" },
      { id: "p5", taskId: "T-1001", seq: 6, at: "2026-09-24T09:14:30Z", type: "tool.use", toolUseId: "tp3", name: "mcp__nervecenter__show_table", input: JSON.stringify({ title: "Recent runs", columns: ["Run", "Status"], rows: [["900100826", "Failed"], ["900100825", "Healthy"]] }) },
      { id: "p6", taskId: "T-1001", seq: 7, at: "2026-09-24T09:14:31Z", type: "tool.result", toolUseId: "tp3", content: "{}" },
      { id: "p7", taskId: "T-1001", seq: 8, at: "2026-09-24T09:15:00Z", type: "approval.requested", inboxId: "I-1", category: "ticket_writes", reason: "The repair run succeeded and the mart is fresh.", title: "Waiting for approval: Comment on ticket OPS-1001", detail: "Ticket changes need approval", tool: { name: "mcp__nervecenter__comment_on_ticket", input: JSON.stringify({ ticketId: "OPS-1001", body: "Fixed", reason: "The repair run succeeded and the mart is fresh." }) } },
    ];
    mockFetch((url) => {
      if (url.includes("/api/me")) return meResponse(testUsers.demo, "developer");
      if (url.endsWith("/api/tasks/T-1001")) return jsonResponse({ ...base, events: planEvents });
      if (url.includes("/api/tasks/T-1001/events")) return sseResponse([]);
      return jsonResponse({ items: [] });
    });
    renderAt("/tasks/T-1001", <Route path="/tasks/:taskId" element={<TaskPage />} />);
    expect(await screen.findByRole("heading", { name: "Fix the Veltrix load" })).toBeInTheDocument();
    expect(screen.getByText("1 of 2 done")).toBeInTheDocument();
    expect(screen.getByText("Run 900100826 failed on plan_type.")).toBeInTheDocument();
    // update_plan is read by the card, not repeated as a step; the table draws where it was shown.
    expect(screen.queryByText(/Marked a plan step/)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Recent runs" })).toBeInTheDocument();
    expect(screen.getByText("Failed")).toHaveClass("text-rose-700");
    // The approval carries the agent's reason.
    expect(screen.getByText(/Why:/).parentElement).toHaveTextContent("The repair run succeeded and the mart is fresh.");
  });

  it("starts a task from the New task page and opens it", async () => {
    mockFetch((url, init) => {
      if (url.endsWith("/api/tasks") && init?.method === "POST") { const body = JSON.parse(String(init.body)); expect(body).toMatchObject({ type: "adhoc", permission: "ask", prompt: "Go through my open tickets, tell me which ones can be closed with the evidence, and close them once I approve." }); return jsonResponse({ ...adhoc, id: "T-2001", status: "queued" }, 201); }
      if (url.endsWith("/api/tasks/T-2001")) return jsonResponse({ ...adhoc, id: "T-2001", status: "queued", events: [] });
      if (url.includes("/events")) return sseResponse([]);
      return jsonResponse({ items: [] });
    });
    renderAt("/tasks/new", <><Route path="/tasks/new" element={<NewTaskPage />} /><Route path="/tasks/:taskId" element={<TaskPage />} /></>);
    // A wide box with the mode chip in its footer instead of a four-way bar, four suggestion cards, and no floating Sonic pill.
    const suggestions = await screen.findByRole("list", { name: "Suggestions" });
    expect(within(suggestions).getAllByRole("button")).toHaveLength(4);
    expect(screen.queryByTestId("autonomy-dial")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Permission: Follow policy" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ask Sonic" })).not.toBeInTheDocument();
    // A card loads its prompt and the mode it suits into the box; nothing starts until the person sends.
    fireEvent.click(within(suggestions).getByRole("button", { name: /Find tickets ready to close/ }));
    const box = screen.getByRole("textbox", { name: "Describe the outcome you want" });
    await waitFor(() => expect(box).toHaveValue("Go through my open tickets, tell me which ones can be closed with the evidence, and close them once I approve."));
    expect(screen.getByRole("button", { name: "Permission: Ask first" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getAllByText(/queued/i).length).toBeGreaterThan(0));
  });

  it("the agent panel offers page prompts and creates a task with page context", async () => {
    let created: Record<string, unknown> | null = null;
    mockFetch((url, init) => {
      if (url.includes("/api/me")) return meResponse(testUsers.demo, "developer");
      if (url.endsWith("/api/tasks") && init?.method === "POST") { created = JSON.parse(String(init.body)); return jsonResponse({ ...adhoc, id: "T-3001", status: "running", events: [] }, 201); }
      if (url.endsWith("/api/tasks/T-3001")) return jsonResponse({ ...adhoc, id: "T-3001", status: "running", events: [{ id: "u1", taskId: "T-3001", seq: 1, at: "2026-09-24T09:14:00Z", type: "user.message", text: "Which of these tickets should I start with?" }] });
      if (url.includes("/events")) return sseResponse([]);
      return jsonResponse({ items: [] });
    });
    renderAt("/tickets?priority=critical", <Route path="/tickets" element={<div>Tickets body</div>} />);
    fireEvent.click(screen.getByRole("button", { name: "Ask Sonic" }));
    const panel = await screen.findByRole("complementary", { name: "Sonic panel" });
    expect(within(panel).getByText(/I can see the Tickets page/)).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "Which of these should I pick up first?" }));
    await waitFor(() => expect(created).not.toBeNull());
    expect(created).toMatchObject({ type: "adhoc", permission: "policy", context: { page: { name: "Tickets", path: "/tickets", filters: { priority: "critical" } } } });
    expect(await within(panel).findByText("Which of these tickets should I start with?")).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "Open as a full task" })).toHaveAttribute("href", "/tasks/T-3001");
  });

  it("shows a pending question as a form in the thread, says who started the task, and holds the composer until it is answered", async () => {
    const questions = [{ question: "Which period should the report cover?", header: "Period", multiSelect: false, options: [{ label: "Last 7 days", description: "Monday to Sunday" }, { label: "Last 30 days" }] }];
    const asking: Task = { ...adhoc, id: "T-4001", status: "waiting", pendingApprovalId: "Q-1", context: { page: { name: "Pipelines", path: "/pipelines" } } };
    const questionEvents: TaskEvent[] = [
      { id: "u1", taskId: "T-4001", seq: 1, at: "2026-09-24T09:14:00Z", type: "user.message", text: "Build the weekly report" },
      { id: "q1", taskId: "T-4001", seq: 2, at: "2026-09-24T09:14:10Z", type: "question.asked", inboxId: "Q-1", title: "Which period should the report cover?", questions },
    ];
    const calls: Array<{ call: string; body: unknown }> = [];
    mockFetch((url, init) => {
      calls.push({ call: `${init?.method || "GET"} ${url}`, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url.includes("/api/me")) return meResponse(testUsers.demo, "developer");
      if (url.endsWith("/api/tasks/T-4001")) return jsonResponse({ ...asking, events: questionEvents });
      if (url.includes("/api/tasks/T-4001/events")) return sseResponse([]);
      if (url.endsWith("/api/inbox/Q-1/answer")) return jsonResponse({ id: "Q-1", status: "answered" });
      return jsonResponse({ items: [] });
    });
    renderAt("/tasks/T-4001", <Route path="/tasks/:taskId" element={<TaskPage />} />);
    expect(await screen.findByText("Sonic has a question")).toBeInTheDocument();
    expect(screen.getByText(/Chat · Started by Demo User · Pipelines/)).toBeInTheDocument();
    expect(screen.getAllByText("Answer Sonic's question above first").length).toBeGreaterThan(0);
    expect(screen.getByRole("textbox", { name: "Ask a follow-up…" })).toBeDisabled();
    // SPEC-tasks-10 FR-2: the outcome line says Sonic waits on an answer.
    expect(screen.getByRole("button", { name: "Waiting for your answer. Go to it" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: /Last 7 days/ }));
    await userEvent.click(screen.getByRole("button", { name: "Send answers" }));
    await waitFor(() => expect(calls.find((entry) => entry.call === "POST /api/inbox/Q-1/answer")?.body).toEqual({ answers: { "Which period should the report cover?": "Last 7 days" } }));
    expect(await screen.findByText(/You answered:/)).toBeInTheDocument();
  });

  it("shows queued messages under the live activity with Edit, Remove and Send now", async () => {
    const running: Task = { ...adhoc, id: "T-5001", status: "running", pendingApprovalId: null, queue: [
      { id: "q1", text: "also check the payer file", actor: { id: "demo.user", name: "Demo User" }, queuedAt: "2026-09-24T09:15:00Z" },
      { id: "q2", text: "and the IQVIA one", actor: { id: "demo.user", name: "Demo User" }, queuedAt: "2026-09-24T09:15:20Z" },
    ] };
    const calls: Array<{ call: string; body: unknown }> = [];
    mockFetch((url, init) => {
      calls.push({ call: `${init?.method || "GET"} ${url}`, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url.includes("/api/me")) return meResponse(testUsers.demo, "developer");
      if (url.endsWith("/api/tasks/T-5001")) return jsonResponse({ ...running, events: events.slice(0, 3).map((event) => ({ ...event, taskId: "T-5001" })) });
      if (url.includes("/api/tasks/T-5001/events")) return sseResponse([]);
      if (url.includes("/api/tasks/T-5001/queue/")) return jsonResponse({ task: running });
      return jsonResponse({ items: [] });
    });
    renderAt("/tasks/T-5001", <Route path="/tasks/:taskId" element={<TaskPage />} />);
    expect(await screen.findByText("Queued · 2")).toBeInTheDocument();
    const queued = screen.getByRole("region", { name: "Queued messages" });
    expect(within(queued).getByText("also check the payer file")).toBeInTheDocument();
    expect(within(queued).getAllByRole("button", { name: "Send now" }).length).toBe(2);

    await userEvent.click(within(queued).getAllByRole("button", { name: "Remove" })[0]);
    await waitFor(() => expect(calls.some((entry) => entry.call === "DELETE /api/tasks/T-5001/queue/q1")).toBe(true));

    await userEvent.click(within(queued).getAllByRole("button", { name: "Edit" })[1]);
    const field = screen.getByRole("textbox", { name: "Edit queued message 2" });
    await userEvent.clear(field); await userEvent.type(field, "and the IQVIA file too{Enter}");
    await waitFor(() => expect(calls.find((entry) => entry.call === "PATCH /api/tasks/T-5001/queue/q2")?.body).toEqual({ text: "and the IQVIA file too" }));

    await userEvent.click(within(queued).getAllByRole("button", { name: "Send now" })[1]);
    await waitFor(() => expect(calls.some((entry) => entry.call === "POST /api/tasks/T-5001/queue/q2/send")).toBe(true));
  });
});

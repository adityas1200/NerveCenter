import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Task, TaskEvent } from "@/api/tasks";
import { ToastProvider } from "@/components/ui";
import { renderWithClient } from "@/test/utils";
import { TaskThread } from "./TaskThread";
import type { StartingTool } from "./useTaskStream";

// The composer shows what Sonic is doing now and for how long, so the thread does not say it a second time.
// Only a reader with no composer (a viewer in the Sonic panel) gets it in the thread (liveStatus).

const task: Task = { id: "T-1", type: "adhoc", title: "Check the routine", summary: "", status: "running", permission: "policy", context: {}, createdBy: { id: "demo.user", name: "Demo User" }, createdAt: "2026-10-16T09:00:00Z", updatedAt: "2026-10-16T09:00:30Z", sessionId: null, cost: { totalUsd: 0, inputTokens: 0, outputTokens: 0, turns: 0, durationMs: 0, runs: 0 }, pendingApprovalId: null } as Task;
let seq = 0;
const ev = (extra: Partial<TaskEvent>): TaskEvent => { seq += 1; return { id: `e${seq}`, taskId: "T-1", seq, at: `2026-10-16T09:00:${String(seq).padStart(2, "0")}Z`, type: "status", ...extra } as TaskEvent; };
const events = (): TaskEvent[] => {
  const read = ev({ type: "tool.use", name: "Read", input: JSON.stringify({ file_path: "operations.yaml" }), toolUseId: "tu-read" });
  return [ev({ type: "user.message", text: "Check the routine" }), read, ev({ type: "tool.result", toolUseId: "tu-read", content: "ok" })];
};
const starting: StartingTool = { name: "Bash", title: "Bash", at: "2026-10-16T09:00:20Z" };

function thread(liveStatus?: boolean) {
  return renderWithClient(<MemoryRouter><ToastProvider><TaskThread task={task} events={events()} pendingApproval={null} startingTool={starting} liveStatus={liveStatus} /></ToastProvider></MemoryRouter>);
}

describe("live status in the thread", () => {
  it("is left to the composer: the steps fold names the steps, with no 'Working', timer, orb or next-step line", () => {
    thread();
    const fold = screen.getByRole("button", { expanded: true });
    expect(fold).toHaveTextContent("1 step");
    expect(fold).not.toHaveTextContent(/Working/);
    expect(screen.queryByLabelText("In progress")).not.toBeInTheDocument();
    expect(screen.queryByText(/^About to/)).not.toBeInTheDocument();
    expect(screen.getByText("operations.yaml")).toBeInTheDocument();
  });

  it("is shown in the thread for a reader who has no composer", () => {
    thread(true);
    expect(screen.getByRole("button", { expanded: true })).toHaveTextContent(/Working/);
    expect(screen.getAllByLabelText("In progress").length).toBeGreaterThan(0);
  });
});

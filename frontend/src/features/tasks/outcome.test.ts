import type { Task, TaskEvent } from "@/api/tasks";
import { outcomeLine } from "./outcome";

// SPEC-tasks-10 FR-2: the outcome line under the task title.
const task: Pick<Task, "status" | "startedAt" | "finishedAt" | "changes" | "context" | "error"> = { status: "done", startedAt: "2026-10-11T09:00:00Z", finishedAt: "2026-10-11T09:04:30Z", changes: 2, context: { ticket: { ticketId: "OPS-1", externalReference: { number: "INC0031201" } } }, error: null };
let seq = 0;
const outcome = (input: Record<string, unknown>, parentToolUseId: string | null = null): TaskEvent => { seq += 1; return { id: `o${seq}`, taskId: "T-1", seq, at: "2026-10-11T09:03:00Z", type: "tool.use", toolUseId: `tu${seq}`, name: "mcp__nervecenter__set_outcome", input: JSON.stringify(input), parentToolUseId }; };

describe("outcomeLine", () => {
  it("takes the state, headline and items of Sonic's latest set_outcome", () => {
    const events = [
      outcome({ state: "in_progress", headline: "Looking at the failed run" }),
      outcome({ state: "recovered", headline: "The Veltrix load is recovered.", items: [{ label: "Root cause", value: "plan_type", tone: "bad" }, { label: "Rows", value: "11,982", tone: "good" }] }),
      // A sub-agent's outcome is not the task's.
      outcome({ state: "failed", headline: "Sub-agent gave up" }, "sub-1"),
    ];
    expect(outcomeLine(task, events)).toEqual({ mood: "good", word: "Recovered", headline: "The Veltrix load is recovered.", items: [{ label: "Root cause", value: "plan_type", tone: "bad" }, { label: "Rows", value: "11,982", tone: "good" }], waiting: null });
  });

  it("falls back to the task's ticket, its changes and the time taken", () => {
    expect(outcomeLine(task, [])).toEqual({ mood: "good", word: "Done", headline: "Worked on INC0031201", items: [{ label: "Changes", value: "2", tone: "neutral" }, { label: "Time", value: expect.stringMatching(/^4m/), tone: "neutral" }], waiting: null });
    expect(outcomeLine({ ...task, status: "failed", error: "The SDK stopped\nstack" }, []).headline).toBe("The SDK stopped");
    expect(outcomeLine({ ...task, status: "cancelled" }, []).word).toBe("Stopped");
  });

  it("says what Sonic is doing while it runs and what it waits on, ahead of any outcome", () => {
    const events = [outcome({ state: "recovered", headline: "Recovered" })];
    expect(outcomeLine({ ...task, status: "running" }, events, { activity: "Reading the runs", elapsedMs: 42_000 })).toMatchObject({ mood: "live", word: "Running", headline: "Reading the runs", waiting: null });
    expect(outcomeLine({ ...task, status: "waiting" }, events, { pendingApproval: true })).toMatchObject({ word: "Needs you", headline: "Waiting for your approval", waiting: "approval" });
    expect(outcomeLine({ ...task, status: "waiting" }, events, { pendingQuestion: true })).toMatchObject({ headline: "Waiting for your answer", waiting: "question" });
  });

  it("lets a failed task outrank an outcome that claims success", () => {
    expect(outcomeLine({ ...task, status: "failed", error: "Crashed" }, [outcome({ state: "resolved", headline: "All good" })])).toMatchObject({ mood: "bad", word: "Failed", headline: "Crashed" });
    expect(outcomeLine({ ...task, status: "failed" }, [outcome({ state: "blocked", headline: "Blocked on access" })])).toMatchObject({ word: "Blocked", headline: "Blocked on access" });
  });
});

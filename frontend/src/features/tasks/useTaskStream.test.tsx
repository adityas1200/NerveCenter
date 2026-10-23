import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Task, TaskEvent } from "@/api/tasks";
import { groupEvents } from "./taskEvents";
import { useTaskStream } from "./useTaskStream";
import { createTestQueryClient, jsonResponse, mockFetch, sseResponse } from "@/test/utils";


const task: Task = { id: "T-7", type: "adhoc", title: "Weekly report", summary: "", status: "waiting", permission: "policy", context: {}, createdBy: { id: "mitesh", name: "Mitesh Shinde" }, createdAt: "2026-09-25T09:00:00Z", updatedAt: "2026-09-25T09:01:00Z", cost: { totalUsd: 0, inputTokens: 0, outputTokens: 0, turns: 0, durationMs: 0, runs: 0 }, pendingApprovalId: "Q-2" };
const questions = [{ question: "Which period?", header: "Period", multiSelect: false, options: [{ label: "Last 7 days" }, { label: "Last 30 days" }] }];
const events: TaskEvent[] = [
  { id: "e1", taskId: "T-7", seq: 1, at: "2026-09-25T09:00:00Z", type: "user.message", text: "Build the weekly report" },
  { id: "e2", taskId: "T-7", seq: 2, at: "2026-09-25T09:00:05Z", type: "tool.use", toolUseId: "tu1", name: "AskUserQuestion", input: JSON.stringify({ questions }) },
  { id: "e3", taskId: "T-7", seq: 3, at: "2026-09-25T09:00:06Z", type: "question.asked", inboxId: "Q-1", title: "Which period?", questions },
  { id: "e4", taskId: "T-7", seq: 4, at: "2026-09-25T09:00:30Z", type: "question.answered", inboxId: "Q-1", answers: { "Which period?": "Last 7 days" }, actor: { id: "mitesh", name: "Mitesh Shinde" } },
  { id: "e5", taskId: "T-7", seq: 5, at: "2026-09-25T09:00:31Z", type: "tool.result", toolUseId: "tu1", content: "{}" },
  { id: "e6", taskId: "T-7", seq: 6, at: "2026-09-25T09:01:00Z", type: "question.asked", inboxId: "Q-2", title: "Which brands?", questions: [{ question: "Which brands?", multiSelect: true, options: [{ label: "Veltrix" }, { label: "Corvana" }] }] },
];

describe("useTaskStream", () => {
  it("exposes the question the task waits on and leaves answered ones settled", async () => {
    mockFetch((url) => { if (url.includes("/events")) return sseResponse(); if (url.endsWith("/api/tasks/T-7")) return jsonResponse({ ...task, events }); return jsonResponse({ items: [] }); });
    const client = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useTaskStream("T-7"), { wrapper });
    await waitFor(() => expect(result.current.task?.id).toBe("T-7"));
    expect(result.current.pendingQuestion?.id).toBe("e6");
    expect(result.current.pendingApproval).toBeNull();
  });

  it("groups a question with its answer and hides the question tool call as a step", () => {
    const groups = groupEvents(events, false);
    expect(groups.map((group) => group.kind)).toEqual(["user", "question", "question"]);
    const first = groups[1];
    expect(first.kind === "question" && first.answered?.answers).toEqual({ "Which period?": "Last 7 days" });
    const second = groups[2];
    expect(second.kind === "question" && second.answered).toBeNull();
  });
});

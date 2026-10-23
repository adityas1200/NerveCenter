import { fireEvent, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "@/components/ui";
import type { Task, TaskEvent } from "@/api/tasks";
import { TaskThread } from "./TaskThread";
import { renderWithClient } from "@/test/utils";

const task: Task = { id: "T-1", type: "adhoc", title: "hi", summary: "", status: "done", permission: "policy", context: {}, createdBy: { id: "u1", name: "Bhawin" }, createdAt: "2026-09-25T09:00:00Z", updatedAt: "2026-09-25T09:01:00Z", cost: { totalUsd: 0, inputTokens: 0, outputTokens: 0, turns: 0, durationMs: 0, runs: 1 } };
const events: TaskEvent[] = [
  { id: "e1", taskId: "T-1", seq: 1, at: "2026-09-25T09:00:00Z", type: "user.message", text: "show me failed pipelines", actor: { id: "u1", name: "Bhawin" } },
  { id: "e2", taskId: "T-1", seq: 2, at: "2026-09-25T09:00:30Z", type: "assistant.text", text: "Two failed overnight." },
];

function renderThread(editable: boolean) {
  return renderWithClient(<MemoryRouter><ToastProvider><TaskThread task={task} events={events} pendingApproval={null} editable={editable} /></ToastProvider></MemoryRouter>);
}

describe("editing a sent message", () => {
  it("turns the bubble into a box and sends the new text to the edit endpoint on Enter", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ ...task, historyVersion: 1 }), { status: 200, headers: { "content-type": "application/json" } })));
    vi.stubGlobal("fetch", fetchMock);
    renderThread(true);
    fireEvent.click(screen.getByRole("button", { name: "Edit this message" }));
    const box = screen.getByRole("textbox", { name: "Edit your message" }) as HTMLTextAreaElement;
    expect(box.value).toBe("show me failed pipelines");
    fireEvent.change(box, { target: { value: "show me failed pipelines from last night" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain("/api/tasks/T-1/messages/e1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ text: "show me failed pipelines from last night" });
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Edit your message" })).toBeNull());
  });

  it("cancels on Escape without calling the backend, and offers nothing to viewers", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const view = renderThread(true);
    fireEvent.click(screen.getByRole("button", { name: "Edit this message" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Edit your message" }), { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText("show me failed pipelines")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    view.unmount();
    renderThread(false);
    expect(screen.queryByRole("button", { name: "Edit this message" })).toBeNull();
  });
});

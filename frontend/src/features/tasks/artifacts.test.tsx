import { fireEvent, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Task, TaskEvent } from "@/api/tasks";
import { AgentPanelProvider } from "@/components/ops/AgentPanel";
import { ToastProvider } from "@/components/ui";
import { ArtifactFrame } from "./cards/ArtifactFrame";
import { artifactFrom, artifactsFrom } from "./cards/cards";
import { stepLabel } from "./stepLabels";
import { groupEvents } from "./taskEvents";
import { TaskPage } from "./TaskPage";
import { jsonResponse, meResponse, mockFetch, renderWithClient, sseResponse, testUsers } from "@/test/utils";

const toolUse = (seq: number, tool: string, input: Record<string, unknown>, taskId = "T-1"): TaskEvent => ({ id: `e${seq}`, taskId, seq, at: `2026-09-25T09:${String(seq).padStart(2, "0")}:00Z`, type: "tool.use", toolUseId: `tu${seq}`, name: `mcp__nervecenter__${tool}`, input: JSON.stringify(input) });
const toolResult = (seq: number, forSeq: number, content: unknown): TaskEvent => ({ id: `e${seq}`, taskId: "T-1", seq, at: `2026-09-25T09:${String(seq).padStart(2, "0")}:00Z`, type: "tool.result", toolUseId: `tu${forSeq}`, content: JSON.stringify(content) });
const show = toolUse(2, "show_artifact", { path: "tasks/T-1/report.html", title: "Weekly pipeline report", kind: "report", summary: "Failures by pipeline, last 7 days" });

const task: Task = { id: "T-1", type: "adhoc", title: "Weekly report", summary: "Report ready", status: "done", permission: "ask", context: { page: { name: "Overview", path: "/" } }, createdBy: { id: "demo.user", name: "Demo User" }, createdAt: "2026-09-25T09:00:00Z", updatedAt: "2026-09-25T09:10:00Z", cost: { totalUsd: 0.1, inputTokens: 100, outputTokens: 50, turns: 1, durationMs: 4000, runs: 1 }, pendingApprovalId: null };

function wrap(ui: ReactElement) {
  return renderWithClient(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("show_artifact events", () => {
  it("groups the call as an artifact and swallows its result instead of listing a step", () => {
    const events: TaskEvent[] = [
      { id: "u1", taskId: "T-1", seq: 1, at: "2026-09-25T09:01:00Z", type: "user.message", text: "Build the weekly report" },
      show,
      toolResult(3, 2, { shown: true, path: "report.html", title: "Weekly pipeline report", kind: "report", summary: null }),
      { id: "a1", taskId: "T-1", seq: 4, at: "2026-09-25T09:04:00Z", type: "assistant.text", text: "The report is above." },
    ];
    expect(groupEvents(events, false).map((group) => group.kind)).toEqual(["user", "artifact", "assistant"]);
  });

  it("reads the frame data with the path made relative to the task folder and the kind defaulted by file type", () => {
    expect(artifactFrom(show)).toMatchObject({ eventId: "e2", path: "report.html", name: "report.html", title: "Weekly pipeline report", kind: "report", summary: "Failures by pipeline, last 7 days", media: "html" });
    expect(artifactFrom(toolUse(5, "show_artifact", { path: "./charts/trend.svg", title: "Trend" }))).toMatchObject({ path: "charts/trend.svg", kind: "image", media: "image" });
    expect(artifactFrom(toolUse(6, "show_artifact", { path: "notes.md", title: "Notes" }))).toMatchObject({ kind: "document", media: "markdown" });
    expect(artifactFrom(toolUse(7, "show_artifact", { path: "../secret.html", title: "No" }))).toBeNull();
    expect(artifactFrom(toolUse(8, "show_table", { title: "Not an artifact", columns: ["A"], rows: [] }))).toBeNull();
    // The same file shown twice keeps its latest call, in one frame.
    expect(artifactsFrom([show, toolUse(9, "show_artifact", { path: "report.html", title: "Weekly pipeline report v2" })]).map((artifact) => artifact.title)).toEqual(["Weekly pipeline report v2"]);
  });

  it("labels the step as 'Showed <title>'", () => {
    expect(stepLabel(show)).toBe("Showed Weekly pipeline report");
    expect(stepLabel(toolUse(3, "show_artifact", { path: "out/summary.svg" }))).toBe("Showed summary.svg");
  });
});

describe("ArtifactFrame", () => {
  it("frames an HTML report in a sandboxed iframe pointed at the raw file, with Expand, Taller and a new-tab link", () => {
    const artifact = artifactFrom(show);
    if (!artifact) throw new Error("expected an artifact");
    const onExpand = vi.fn();
    wrap(<ArtifactFrame artifact={artifact} taskId="T-1" onExpand={onExpand} />);
    expect(screen.getByRole("heading", { name: "Weekly pipeline report" })).toBeInTheDocument();
    expect(screen.getByText("Report · Failures by pipeline, last 7 days")).toBeInTheDocument();
    const frame = screen.getByTitle("Weekly pipeline report");
    expect(frame.tagName).toBe("IFRAME");
    expect(frame).toHaveAttribute("src", "/api/tasks/T-1/files/raw?path=report.html");
    expect(frame).toHaveAttribute("sandbox", "");
    expect(frame.parentElement).toHaveStyle({ height: "560px" });
    fireEvent.click(screen.getByRole("button", { name: "Taller" }));
    expect(frame.parentElement).toHaveStyle({ height: "900px" });
    expect(screen.getByRole("button", { name: "Fit" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    expect(onExpand).toHaveBeenCalledWith("report.html");
    const newTab = screen.getByRole("link", { name: "Open in new tab" });
    expect(newTab).toHaveAttribute("href", "/api/tasks/T-1/files/raw?path=report.html");
    expect(newTab).toHaveAttribute("target", "_blank");
  });

  it("keeps the short height in the compact form and links to the task when there is no viewer to expand into", () => {
    const artifact = artifactFrom(show);
    if (!artifact) throw new Error("expected an artifact");
    wrap(<ArtifactFrame artifact={artifact} taskId="T-1" compact />);
    expect(screen.getByTitle("Weekly pipeline report").parentElement).toHaveStyle({ height: "320px" });
    expect(screen.getByRole("link", { name: "Open task" })).toHaveAttribute("href", "/tasks/T-1");
    expect(screen.queryByRole("button", { name: "Expand" })).not.toBeInTheDocument();
  });

  it("draws an SVG as a contained image and says so when it cannot load", () => {
    const artifact = artifactFrom(toolUse(5, "show_artifact", { path: "charts/trend.svg", title: "Failure trend" }));
    if (!artifact) throw new Error("expected an artifact");
    wrap(<ArtifactFrame artifact={artifact} taskId="T-1" />);
    const image = screen.getByRole("img", { name: "Failure trend" });
    expect(image).toHaveAttribute("src", "/api/tasks/T-1/files/raw?path=charts%2Ftrend.svg");
    expect(image).toHaveClass("object-contain");
    expect(screen.queryByRole("button", { name: "Taller" })).not.toBeInTheDocument();
    fireEvent.error(image);
    expect(screen.getByRole("alert")).toHaveTextContent("The artifact could not be loaded");
    expect(screen.getByRole("alert")).toHaveTextContent("charts/trend.svg");
  });
});

describe("TaskPage artifacts", () => {
  function renderTask(events: TaskEvent[], files: Array<{ name: string; path: string; type: "file"; size: number }>) {
    mockFetch((url) => {
      if (url.includes("/api/me")) return meResponse(testUsers.demo, "developer");
      if (url.endsWith("/api/tasks/T-1")) return jsonResponse({ ...task, events });
      if (url.endsWith("/api/tasks/T-1/files")) return jsonResponse({ id: "T-1", items: files });
      if (url.includes("/api/tasks/T-1/events")) return sseResponse();
      return jsonResponse({ items: [] });
    });
    return renderWithClient(<MemoryRouter initialEntries={["/tasks/T-1"]}><ToastProvider><AgentPanelProvider><Routes><Route path="/tasks/:taskId" element={<TaskPage />} /></Routes></AgentPanelProvider></ToastProvider></MemoryRouter>);
  }

  // SPEC-tasks-10 FR-1, FR-3: the frame sits in the thread where Sonic showed it; the Details sheet lists the files and marks it.
  it("frames the called artifact in the thread and marks it in the Details sheet's files", async () => {
    const events: TaskEvent[] = [
      { id: "u1", taskId: "T-1", seq: 1, at: "2026-09-25T09:01:00Z", type: "user.message", text: "Build the weekly report" },
      show,
      toolResult(3, 2, { shown: true, path: "report.html", title: "Weekly pipeline report", kind: "report", summary: null }),
      { id: "a1", taskId: "T-1", seq: 4, at: "2026-09-25T09:04:00Z", type: "assistant.text", text: "Report ready.\n\nThree pipelines failed more than once." },
    ];
    renderTask(events, [{ name: "report.html", path: "report.html", type: "file", size: 4096 }, { name: "data.csv", path: "data.csv", type: "file", size: 200 }]);
    const frame = await screen.findByTitle("Weekly pipeline report");
    expect(frame.tagName).toBe("IFRAME");
    expect(frame).toHaveAttribute("sandbox", "");
    expect(screen.getByRole("heading", { name: "Weekly pipeline report" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    const files = await screen.findByRole("region", { name: "Files" });
    expect(await within(files).findByTitle("data.csv")).toBeInTheDocument();
    expect(within(files).getAllByText("Artifact")).toHaveLength(1);
  });

  it("does not frame an older task's HTML file that Sonic never showed", async () => {
    const events: TaskEvent[] = [
      { id: "u1", taskId: "T-1", seq: 1, at: "2026-09-25T09:01:00Z", type: "user.message", text: "Build the weekly report" },
      { id: "a1", taskId: "T-1", seq: 2, at: "2026-09-25T09:04:00Z", type: "assistant.text", text: "Report ready.\n\nThe report is in weekly_report.html." },
    ];
    renderTask(events, [{ name: "weekly_report.html", path: "weekly_report.html", type: "file", size: 4096 }]);
    expect(await screen.findByText("The report is in weekly_report.html.", { exact: false })).toBeInTheDocument();
    expect(document.querySelector("iframe")).toBeNull();
  });
});

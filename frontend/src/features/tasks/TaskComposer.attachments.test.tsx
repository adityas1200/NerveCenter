import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { tasksApi, type Task, type TaskEvent } from "@/api/tasks";
import { AgentPanelProvider } from "@/components/ops/AgentPanel";
import { ToastProvider } from "@/components/ui";
import { jsonResponse, meResponse, mockFetch, renderWithClient, sseResponse, testUsers } from "@/test/utils";
import { addAttachments } from "./attachments";
import { TaskComposer } from "./TaskComposer";
import { TaskPage } from "./TaskPage";
import { TaskThread } from "./TaskThread";

// SPEC-tasks-11: attaching files to a message from the + button, a drop or a paste, and showing them after.
const file = (name: string, body = "x", type = "text/plain") => new File([body], name, { type });
const big = (name: string, bytes: number) => { const item = file(name); Object.defineProperty(item, "size", { value: bytes }); return item; };
const base64 = (text: string) => btoa(text);

describe("FR-2 FR-3 FR-4 checking picked files", () => {
  it("keeps files Sonic can read and names the ones it leaves out", () => {
    const { files, problems } = addAttachments([], [file("shot.png"), file("notes.doc"), file("empty.csv", ""), big("huge.pdf", 11 * 1024 * 1024)]);
    expect(files.map((item) => item.name)).toEqual(["shot.png"]);
    expect(problems).toEqual([
      expect.stringContaining("notes.doc can't be attached"),
      "empty.csv is empty.",
      expect.stringContaining("huge.pdf is 11.0 MB"),
    ]);
  });

  it("stops at ten files and at 25 MB together", () => {
    const ten = Array.from({ length: 10 }, (_, index) => file(`r${index}.csv`));
    expect(addAttachments(ten, [file("one-more.csv")]).problems).toEqual(["A message can hold at most 10 files."]);
    const heavy = [big("a.pdf", 9 * 1024 * 1024), big("b.pdf", 9 * 1024 * 1024)];
    const result = addAttachments(heavy, [big("c.pdf", 9 * 1024 * 1024)]);
    expect(result.files).toHaveLength(2);
    expect(result.problems[0]).toContain("c.pdf would take the message over");
  });
});

describe("FR-1 FR-2 the message box takes files", () => {
  const setup = () => {
    const onSend = vi.fn(() => Promise.resolve());
    const view = renderWithClient(<TaskComposer attachments onSend={onSend} />);
    const box = screen.getByRole("textbox");
    return { onSend, view, box };
  };

  it("adds files from the + button, removes one, and sends files with no text", async () => {
    const { onSend } = setup();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    fireEvent.change(screen.getByTestId("attachment-input"), { target: { files: [file("runs.csv", "a,b"), file("notes.md", "# hi")] } });
    const list = screen.getByRole("list", { name: "Attached files" });
    expect(within(list).getByText("runs.csv")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove notes.md" }));
    expect(within(list).queryByText("notes.md")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("", [], [{ name: "runs.csv", data: base64("a,b") }]));
    await waitFor(() => expect(screen.queryByRole("list", { name: "Attached files" })).toBeNull());
  });

  it("takes a dropped file and a pasted screenshot, and says why a file was left out", async () => {
    const { onSend, box } = setup();
    const surface = box.closest("div.relative") as HTMLElement;
    fireEvent.dragOver(surface, { dataTransfer: { types: ["Files"], files: [] } });
    expect(screen.getByText("Drop files to attach")).toBeInTheDocument();
    fireEvent.drop(surface, { dataTransfer: { types: ["Files"], files: [file("job.log", "boom"), file("deck.key")] } });
    expect(screen.queryByText("Drop files to attach")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("deck.key can't be attached");
    fireEvent.paste(box, { clipboardData: { files: [file("image.png", "png", "image/png")], getData: () => "" } });
    expect(screen.getByText("image.png")).toBeInTheDocument();
    fireEvent.change(box, { target: { value: "why did this fail?" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("why did this fail?", [], [{ name: "job.log", data: base64("boom") }, { name: "image.png", data: base64("png") }]));
  });

  it("the + offers Images or Files, and each picker takes only its own types", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Attach files" }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([expect.stringMatching(/^ImagesPNG/), expect.stringMatching(/^FilesPDF/)]);
    expect(screen.getByTestId("image-input")).toHaveAttribute("accept", ".png,.jpg,.jpeg,.gif,.webp");
    expect(screen.getByTestId("attachment-input")).toHaveAttribute("accept", ".pdf,.docx,.xlsx,.pptx,.vtt,.txt,.md,.csv,.tsv,.json,.yaml,.yml,.sql,.log");
    const opened = vi.spyOn(screen.getByTestId("image-input"), "click").mockImplementation(() => {});
    await userEvent.click(within(menu).getByRole("menuitem", { name: /Images/ }));
    expect(opened).toHaveBeenCalled();
  });

  it("has no + button unless attachments are on", () => {
    renderWithClient(<TaskComposer onSend={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Attach files" })).toBeNull();
  });
});

describe("FR-5 the API sends the files", () => {
  it("puts attachments on a new task and on a follow-up, and leaves them off when there are none", async () => {
    const bodies: unknown[] = [];
    mockFetch((_url, init) => { bodies.push(JSON.parse(String(init?.body))); return jsonResponse({ id: "T-1" }); });
    const attachments = [{ name: "shot.png", data: "AAAA" }];
    await tasksApi.create({ prompt: "", attachments });
    await tasksApi.send("T-1", "see", undefined, undefined, attachments);
    await tasksApi.send("T-1", "no files");
    expect(bodies).toEqual([{ prompt: "", attachments }, { text: "see", attachments }, { text: "no files" }]);
  });
});

const task: Task = { id: "T-7", type: "adhoc", title: "Look", summary: "", status: "done", permission: "policy", context: {}, createdBy: { id: "dev", name: "Dev" }, createdAt: "2026-10-12T09:00:00Z", updatedAt: "2026-10-12T09:01:00Z", cost: { totalUsd: 0, inputTokens: 0, outputTokens: 0, turns: 1, durationMs: 1, runs: 1 }, pendingApprovalId: null };
const events: TaskEvent[] = [
  { id: "u1", taskId: "T-7", seq: 1, at: "2026-10-12T09:00:00Z", type: "user.message", text: "why?", actor: { id: "dev", name: "Dev" }, attachments: [{ name: "shot.png", path: "attachments/q-1/shot.png", size: 2048, mime: "image/png" }, { name: "runs.csv", path: "attachments/q-1/runs.csv", size: 30, mime: "text/csv" }] },
  { id: "a1", taskId: "T-7", seq: 2, at: "2026-10-12T09:00:30Z", type: "assistant.text", text: "The load timed out." },
];

describe("FR-10 a message shows its files", () => {
  it("shows an image thumbnail and a file chip that open in the viewer", () => {
    const onOpenFile = vi.fn();
    renderWithClient(<MemoryRouter><ToastProvider><TaskThread task={task} events={events} pendingApproval={null} onOpenFile={onOpenFile} /></ToastProvider></MemoryRouter>);
    const list = screen.getByRole("list", { name: "Attached files" });
    expect(within(list).getByRole("img", { name: "shot.png" })).toHaveAttribute("src", expect.stringContaining("/api/tasks/T-7/files/raw?path=attachments%2Fq-1%2Fshot.png"));
    fireEvent.click(within(list).getByRole("button", { name: "Open runs.csv" }));
    expect(onOpenFile).toHaveBeenCalledWith("attachments/q-1/runs.csv");
  });

  it("links to the file when the thread has no viewer", () => {
    renderWithClient(<MemoryRouter><ToastProvider><TaskThread task={task} events={events} pendingApproval={null} /></ToastProvider></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Open runs.csv" })).toHaveAttribute("target", "_blank");
  });
});

describe("FR-11 the Details sheet lists attachments", () => {
  beforeEach(() => { Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() }); });
  afterEach(() => { delete (HTMLElement.prototype as Partial<HTMLElement>).scrollTo; });

  it("sends the files from the task page and reloads the task's files", async () => {
    const sent: unknown[] = [];
    let fileReads = 0;
    mockFetch((url, init) => {
      if (url.includes("/api/me")) return meResponse(testUsers.dev, "developer");
      if (url.endsWith("/api/tasks/T-7/messages") && init?.method === "POST") { sent.push(JSON.parse(String(init.body))); return jsonResponse({ queued: false, task }); }
      if (url.endsWith("/api/tasks/T-7")) return jsonResponse({ ...task, events });
      if (url.endsWith("/api/tasks/T-7/files")) { fileReads += 1; return jsonResponse({ id: "T-7", items: [{ name: "attachments", path: "attachments", type: "directory", children: [{ name: "q-1", path: "attachments/q-1", type: "directory", children: [{ name: "shot.png", path: "attachments/q-1/shot.png", type: "file", size: 2048 }] }] }] }); }
      if (url.includes("/api/tasks/T-7/events")) return sseResponse();
      return jsonResponse({ items: [] });
    });
    renderWithClient(<MemoryRouter initialEntries={["/tasks/T-7"]}><ToastProvider><AgentPanelProvider><Routes><Route path="/tasks/:taskId" element={<TaskPage />} /></Routes></AgentPanelProvider></ToastProvider></MemoryRouter>);
    await screen.findByText("The load timed out.");
    await waitFor(() => expect(fileReads).toBeGreaterThan(0));
    const before = fileReads;
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    const sheet = await screen.findByRole("dialog");
    expect(await within(within(sheet).getByRole("region", { name: "Files" })).findByTitle("shot.png")).toBeInTheDocument();
    fireEvent.keyDown(sheet, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // The Sonic panel has a message box too; use the task page's own.
    const composer = within(screen.getByRole("textbox", { name: "Ask a follow-up…" }).closest("div.relative")!.parentElement!);
    fireEvent.change(composer.getByTestId("attachment-input"), { target: { files: [file("more.txt", "hi")] } });
    fireEvent.click(composer.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(sent).toEqual([{ text: "", attachments: [{ name: "more.txt", data: base64("hi") }] }]));
    await waitFor(() => expect(fileReads).toBeGreaterThan(before));
  });
});

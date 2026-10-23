import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NotificationsTray } from "./NotificationsTray";
import { isNotification } from "./notificationKinds";
import { jsonResponse, mockFetch, renderWithClient } from "@/test/utils";

const at = new Date(Date.now() - 60_000).toISOString();
const items = [
  { id: "agent:I-1", kind: "agent.approval", title: "Sonic needs your approval: grant role", at, href: "/inbox", tone: "warning" },
  { id: "agent:I-2", kind: "agent.question", title: "Sonic asked: dev or prod?", at, href: "/inbox", tone: "warning" },
  { id: "agent:I-3", kind: "agent.update", title: "Sonic: Daily ticket review finished", at, href: "/tasks/T-1", tone: "neutral" },
  { id: "ticket.created:T-9", kind: "ticket.created", title: "Backfill HCP master", detail: "T-9 · opened", at, href: "/tickets/T-9", tone: "neutral" },
];

describe("NotificationsTray", () => {
  beforeEach(() => { vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(460); vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(380); });
  afterEach(() => { window.localStorage.clear(); vi.restoreAllMocks(); });

  it("counts notifications only, never approvals or questions, and opens with them left out", async () => {
    mockFetch(() => jsonResponse({ generatedAt: at, since: null, total: items.length, items, system: [], unread: 2, systemCount: 0, watermark: "initial", nextCursor: null }));
    renderWithClient(<MemoryRouter><NotificationsTray /></MemoryRouter>);
    const bell = await screen.findByRole("button", { name: "Notifications, 2 unread" });
    fireEvent.click(bell);
    expect(await screen.findByText("Sonic: Daily ticket review finished")).toBeInTheDocument();
    expect(screen.getByText("Backfill HCP master")).toBeInTheDocument();
    expect(screen.queryByText(/needs your approval/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Sonic asked/)).not.toBeInTheDocument();
  });

  it("keeps system, ticket, pipeline and dq items", () => {
    for (const kind of ["notification", "agent.update", "ticket.status", "pipeline.failed", "dq.failed", "system.connection"]) expect(isNotification({ id: kind, kind, title: "", at, href: "/", tone: "neutral" })).toBe(true);
    for (const kind of ["agent.approval", "agent.question", "approval.pending"]) expect(isNotification({ id: kind, kind, title: "", at, href: "/", tone: "neutral" })).toBe(false);
  });

  it("polls summary while closed, fetches the selected tab on open, and prepends matching updates", async () => {
    let burst = false;
    const calls: URLSearchParams[] = [];
    mockFetch(url => {
      const q = new URL(url, "http://local").searchParams; calls.push(q);
      const common = { generatedAt: at, unread: 75, systemCount: 0, watermark: "initial", system: [], nextCursor: null };
      if (q.get("mode") === "summary") return jsonResponse(common);
      if (q.get("mode") === "page") return jsonResponse({ ...common, items: q.get("view") === "agent" ? [items[2]] : items.slice(2) });
      return jsonResponse({ ...common, items: burst ? [{ ...items[2], id: "new-agent", title: "New Sonic result" }, { ...items[3], id: "new-ticket", title: "New ticket result" }] : [] });
    });
    vi.useFakeTimers();
    const view = renderWithClient(<MemoryRouter><NotificationsTray /></MemoryRouter>);
    await act(async () => { await vi.advanceTimersByTimeAsync(20); });
    const bell = screen.getByRole("button", { name: "Notifications, 75 unread" });
    try {
      await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
      expect(calls.map(q => q.get("mode"))).toEqual(["summary", "summary"]);
      fireEvent.click(bell);
      await act(async () => { await vi.advanceTimersByTimeAsync(20); });
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Sonic" }), { button: 0, ctrlKey: false });
      await act(async () => { await vi.advanceTimersByTimeAsync(20); });
      expect(calls.some(q => q.get("mode") === "page" && q.get("view") === "agent")).toBe(true);
      burst = true;
      await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
      expect(screen.getByText("New Sonic result")).toBeInTheDocument();
      expect(screen.queryByText("New ticket result")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Notifications, 75 unread" })).toBeInTheDocument();
    } finally { view.unmount(); view.client.clear(); vi.useRealTimers(); }
  });

  it("prefetches one older page at 300px without reloading page one", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(1800);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(460);
    let olderReads = 0;
    let release!: () => void;
    mockFetch(async url => {
      const q = new URL(url, "http://local").searchParams;
      if (q.get("mode") === "summary") return jsonResponse({ unread: 1, systemCount: 0, watermark: "initial" });
      if (q.get("mode") === "updates") return jsonResponse({ unread: 1, system: [], items: [], watermark: "initial", nextCursor: null });
      if (q.get("cursor")) { olderReads++; await new Promise<void>(resolve => { release = resolve; }); return jsonResponse({ items: [{ ...items[3], id: "older", title: "Older ticket" }], system: [], nextCursor: null }); }
      return jsonResponse({ items: [items[2]], system: [], nextCursor: "older-page" });
    });
    renderWithClient(<MemoryRouter><NotificationsTray /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "Notifications, 1 unread" }));
    await screen.findByText("Sonic: Daily ticket review finished");
    const scroll = document.querySelector<HTMLElement>(".overflow-y-auto")!;
    scroll.scrollTop = 1039; fireEvent.scroll(scroll);
    expect(olderReads).toBe(0);
    scroll.scrollTop = 1040; fireEvent.scroll(scroll); fireEvent.scroll(scroll);
    await waitFor(() => expect(olderReads).toBe(1));
    await act(async () => release());
    expect(olderReads).toBe(1);
  });
});

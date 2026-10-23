import { fireEvent, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { GuideQuestion } from "@/api/tasks";
import { jsonResponse, mockFetch, renderWithClient } from "@/test/utils";
import { InterviewGuidePanel } from "./InterviewGuidePanel";

// SPEC-knowledge-03 FR-7, FR-8, FR-11: the Interview guide tab of a knowledge setup task.

const question = (id: string, patch: Partial<GuideQuestion> = {}): GuideQuestion => ({ id, theme: "Sales load", question: `Question ${id}?`, why: "", evidence: [], audience: "", priority: "medium", status: "open", answer: "", cites: [], pages: [], round: 1, updatedAt: null, ...patch });
const base = { name: "team-knowledge", title: "Team knowledge", description: "", hasIndex: true, kind: "local", url: null, branch: null, folders: [], hasToken: false, addedBy: null, addedAt: null, lastSyncAt: null, lastCommit: null, lastError: null, files: 4, pendingChanges: 3 };

function renderPanel(guide: unknown, { status = 200, urls = [] as string[], basename = undefined as string | undefined } = {}) {
  mockFetch((url) => {
    urls.push(url);
    if (url.includes("/interview-guide")) return status === 200 ? jsonResponse(guide) : jsonResponse({ error: "Task not found" }, status);
    if (url.endsWith("/api/knowledge")) return jsonResponse({ items: [base], mcp: { mode: "local", connection: "", collections: [] } });
    return jsonResponse({});
  });
  return renderWithClient(<MemoryRouter basename={basename} initialEntries={[`${basename || ""}/tasks/T-7`]}><InterviewGuidePanel taskId="T-7" base="team-knowledge" live={false} version={0} /></MemoryRouter>);
}

describe("InterviewGuidePanel", () => {
  it("reads the guide from its route and shows counts, themes, statuses and the drafts waiting", async () => {
    const urls: string[] = [];
    renderPanel({ updatedAt: null, questions: [
      question("G-1", { priority: "high", audience: "Ops lead", why: "Two reruns with no cause.", evidence: [{ label: "INC-4821", href: "/tickets/OPS-4821" }] }),
      question("G-2", { theme: "Ownership", status: "answered", answer: "Data Ops owns it.", cites: [{ file: "kt-1.vtt", at: "00:12:40", speaker: "Priya" }], pages: ["team/ownership.md"] }),
    ] }, { urls });
    expect(await screen.findByText("Question G-1?")).toBeInTheDocument();
    expect(urls.some((url) => url.endsWith("/api/tasks/T-7/interview-guide"))).toBe(true);
    expect(screen.getByLabelText("Questions by status")).toHaveTextContent("1 open · 1 answered");
    expect(within(screen.getByRole("region", { name: "Sales load" })).getByText("High priority")).toBeInTheDocument();
    expect(screen.getByText("Ask Ops lead")).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: /3 drafts in Team knowledge to review/ })).toHaveAttribute("href", "/knowledge/team-knowledge?drafts=1");

    fireEvent.click(screen.getByRole("button", { name: /G-2/ }));
    expect(screen.getByText("Data Ops owns it.")).toBeInTheDocument();
    expect(screen.getByText("kt-1.vtt · 00:12:40 · Priya")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "team/ownership.md" })).toHaveAttribute("href", "/knowledge?path=team%2Fownership.md");

    fireEvent.click(screen.getByRole("button", { name: /G-1/ }));
    expect(screen.getByRole("link", { name: "INC-4821" })).toHaveAttribute("href", "/tickets/OPS-4821");
    expect(screen.getByRole("button", { name: /G-1/ })).toHaveAttribute("aria-expanded", "true");
  });

  it("Still to ask hides settled questions; Download is off when nothing is left to ask", async () => {
    renderPanel({ updatedAt: null, questions: [question("G-1", { status: "answered" }), question("G-2", { status: "dropped" })] });
    expect(await screen.findByText("Question G-1?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Download/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("switch", { name: "Show only questions still to ask" }));
    expect(screen.queryByText("Question G-1?")).toBeNull();
    expect(screen.getByText("Every question is settled.")).toBeInTheDocument();
  });

  it("says what happens when there are no questions yet", async () => {
    renderPanel({ updatedAt: null, questions: [] });
    expect(await screen.findByText(/No questions yet\. Sonic adds them here/)).toBeInTheDocument();
  });

  it("shows a failed load with a way to try again", async () => {
    renderPanel(null, { status: 500 });
    expect(await screen.findByText("The interview guide did not load")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("downloads the questions still to ask, with app links that open this project", async () => {
    let saved: Blob | null = null;
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn((blob: Blob) => { saved = blob; return "blob:guide"; }) });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    renderPanel({ updatedAt: null, questions: [question("G-1", { evidence: [{ label: "INC-4821", href: "/tickets/OPS-4821" }] }), question("G-2", { status: "answered" })] }, { basename: "/p/helixa" });
    fireEvent.click(await screen.findByRole("button", { name: /Download/ }));
    expect(click).toHaveBeenCalled();
    // jsdom's Blob has no text(); FileReader reads it.
    const text = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(saved as unknown as Blob); });
    expect(text).toContain("# Interview guide: Team knowledge");
    expect(text).toContain(`- Evidence: INC-4821 (${window.location.origin}/p/helixa/tickets/OPS-4821)`);
    expect(text).not.toContain("G-2");
    click.mockRestore();
  });
});

import { fireEvent, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { KnowledgeMap as MapData } from "@/api/library";
import { ToastProvider } from "@/components/ui";
import { jsonResponse, mockFetch, renderWithClient } from "@/test/utils";
import { KnowledgeMap } from "./KnowledgeMap";
import { MAP_SIZE, layoutMap, searchNodes } from "./knowledgeMapLayout";

// SPEC-knowledge-04 FR-11, FR-12: the map of one base's pages and typed links.

const node = (path: string, extra: Partial<MapData["pages"][number]> = {}): MapData["pages"][number] => ({ path, title: path.split("/").pop()!.replace(/\.md$/, "").replace(/-/g, " "), type: null, shelf: path.split("/")[0], status: "kept", stale: false, staleAfter: null, owner: null, description: null, fields: {}, links: [], ...extra });
const data: MapData = {
  base: "helixa", title: "Helixa",
  pages: [
    node("business/brand-x.md", { title: "Brand X", type: "Brand", links: [{ field: "stakeholders", target: "business/jane-doe", page: "business/jane-doe.md" }] }),
    node("business/jane-doe.md", { title: "Jane Doe", type: "Stakeholder", fields: { tier: "VP" } }),
    node("pipelines/sales-daily.md", { title: "Sales daily", type: "Pipeline", owner: "Ravi", fields: { sla: "07:00 ET" }, links: [{ field: "brands", target: "business/brand-x.md", page: "business/brand-x.md" }, { field: "upstream", target: "IQVIA feed", page: null }] }),
    node("pipelines/claims.md", { title: "Claims weekly", status: "draft" }),
    node("runbooks/old.md", { title: "Old runbook", stale: true, staleAfter: "2020-01-01" }),
  ],
  shelves: [{ name: "business", pages: 2, drafts: 0, stale: 0 }, { name: "pipelines", pages: 2, drafts: 1, stale: 0 }, { name: "runbooks", pages: 1, drafts: 0, stale: 1 }],
  totals: { pages: 5, kept: 4, drafts: 1, stale: 1, links: 2, orphans: 2 },
  truncated: false,
};

function renderMap(map: MapData | null = data, onOpenPage = vi.fn()) {
  mockFetch((url) => (url.endsWith("/api/knowledge/helixa/map") ? (map ? jsonResponse(map) : jsonResponse({ error: "Knowledge base not found" }, 404)) : jsonResponse({})));
  renderWithClient(<MemoryRouter><ToastProvider><KnowledgeMap base="helixa" onOpenPage={onOpenPage} /></ToastProvider></MemoryRouter>);
  return { onOpenPage };
}

describe("knowledge map layout", () => {
  it("FR-11 puts every page inside the canvas, shelves in name order, and draws only resolved links", () => {
    const layout = layoutMap(data);
    expect(layout.shelves.map((shelf) => shelf.name)).toEqual(["business", "pipelines", "runbooks"]);
    for (const placed of layout.nodes) { expect(placed.x).toBeGreaterThan(0); expect(placed.x).toBeLessThan(MAP_SIZE); expect(placed.y).toBeGreaterThan(0); expect(placed.y).toBeLessThan(MAP_SIZE); }
    expect(layout.links.map((link) => [link.from, link.to, link.field])).toEqual([["business/brand-x.md", "business/jane-doe.md", "stakeholders"], ["pipelines/sales-daily.md", "business/brand-x.md", "brands"]]);
    expect(layout.links[1].crossShelf).toBe(true);
    // A linked page is drawn larger than an unlinked one.
    expect(layout.byPath.get("business/brand-x.md")!.r).toBeGreaterThan(layout.byPath.get("runbooks/old.md")!.r);
  });

  it("FR-12 search matches titles, fields and link targets", () => {
    expect(searchNodes(data.pages, "iqvia").map((page) => page.path)).toEqual(["pipelines/sales-daily.md"]);
    expect(searchNodes(data.pages, "vp").map((page) => page.path)).toEqual(["business/jane-doe.md"]);
    expect(searchNodes(data.pages, "  ")).toEqual([]);
  });
});

describe("KnowledgeMap", () => {
  it("FR-11 shows the totals, the shelves and every page with its state", async () => {
    renderMap();
    expect(await screen.findByRole("group", { name: /Map of 5 pages and 2 links/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Needs review: 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Past review date: 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Claims weekly, needs review" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Old runbook, past review date" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sales daily, kept" })).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Filter by shelf" })).getAllByRole("button").map((button) => button.textContent)).toEqual(["Business2", "Pipelines2", "Runbooks1"]);
  });

  it("FR-12 picking a page shows its fields, its links by field and what links to it; a linked page can be picked from there", async () => {
    const { onOpenPage } = renderMap();
    fireEvent.click(await screen.findByRole("button", { name: "Sales daily, kept" }));
    const panel = screen.getByRole("complementary", { name: "About Sales daily" });
    expect(within(panel).getByText("07:00 ET")).toBeInTheDocument();
    expect(within(panel).getByText("Ravi")).toBeInTheDocument();
    expect(within(panel).getByText("Brands")).toBeInTheDocument();
    expect(within(panel).getByText("IQVIA feed")).toHaveAttribute("title", "No page for this yet");
    expect(within(panel).getByText("Nothing links here yet")).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "Brand X" }));
    const brand = screen.getByRole("complementary", { name: "About Brand X" });
    expect(within(brand).getByRole("button", { name: "Sales daily" })).toBeInTheDocument();
    expect(within(brand).getByRole("button", { name: "Jane Doe" })).toBeInTheDocument();
    fireEvent.click(within(brand).getByRole("button", { name: /Open page/ }));
    expect(onOpenPage).toHaveBeenCalledWith("business/brand-x.md");
  });

  it("FR-12 shelf chips, the state filter and search narrow the map; keys walk the pages", async () => {
    const { onOpenPage } = renderMap();
    const chips = await screen.findByRole("group", { name: "Filter by shelf" });
    const runbooks = within(chips).getByRole("button", { name: /^Runbooks/ });
    fireEvent.click(runbooks);
    expect(runbooks).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Clear 1" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear 1" }));

    fireEvent.change(screen.getByLabelText("Find a page"), { target: { value: "iqvia" } });
    expect(screen.getByText("1 found")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByLabelText("Find a page"), { key: "Enter" });
    expect(screen.getByRole("complementary", { name: "About Sales daily" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Find a page"), { target: { value: "" } });

    const map = screen.getByRole("group", { name: /Map of 5 pages/ });
    fireEvent.keyDown(map, { key: "Escape" });
    expect(screen.getByRole("complementary", { name: "Shelves" })).toBeInTheDocument();
    fireEvent.keyDown(map, { key: "ArrowRight" });
    expect(screen.getByRole("complementary", { name: /^About / })).toBeInTheDocument();
    fireEvent.keyDown(map, { key: "Enter" });
    expect(onOpenPage).toHaveBeenCalledTimes(1);
  });

  it("FR-11 an empty base and a failed load each say so", async () => {
    renderMap({ ...data, pages: [], shelves: [], totals: { pages: 0, kept: 0, drafts: 0, stale: 0, links: 0, orphans: 0 } });
    expect(await screen.findByText("No pages yet")).toBeInTheDocument();
  });

  it("FR-11 a failed load shows the error", async () => {
    renderMap(null);
    expect(await screen.findByText(/Knowledge base not found/)).toBeInTheDocument();
  });
});

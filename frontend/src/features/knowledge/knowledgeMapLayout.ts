import type { KnowledgeMap, KnowledgeMapNode } from "@/api/library";

/**
 * Layout for the knowledge map (SPEC-knowledge-04 FR-11): shelves are sectors of a circle, sized by their page count;
 * each shelf's pages sit on rings inside its sector, grouped by type; typed links are curves bent towards the centre,
 * so links between shelves cross the middle and links inside a shelf stay near its edge. Pure, so it is tested alone.
 */

export const MAP_SIZE = 1000;
/** The drawing area: the circle plus room for shelf names on every side. */
export const VIEW = { x: -130, y: -20, width: 1260, height: 1040 };
const CENTER = MAP_SIZE / 2;
export const INNER = 215;
export const OUTER = 405;
const RING_GAP = 34;
const SPACING = 26;
const SHELF_GAP = 0.06;
const LABEL_RADIUS = 452;
export const MAX_NODES = 400;

export interface PlacedNode extends KnowledgeMapNode { x: number; y: number; r: number; angle: number; degree: number; index: number }
export interface PlacedLink { id: string; from: string; to: string; field: string; d: string; crossShelf: boolean }
export interface PlacedShelf { name: string; label: string; start: number; end: number; mid: number; arc: string; sector: string; labelX: number; labelY: number; anchor: "start" | "middle" | "end"; pages: number; drafts: number; stale: number }
export interface MapLayout { nodes: PlacedNode[]; links: PlacedLink[]; shelves: PlacedShelf[]; byPath: Map<string, PlacedNode> }

const polar = (radius: number, angle: number) => ({ x: CENTER + radius * Math.cos(angle), y: CENTER + radius * Math.sin(angle) });
const round = (value: number) => Math.round(value * 10) / 10;
/** "known-issues" → "Known issues". */
export const shelfLabel = (name: string) => { const words = name.replace(/[-_]+/g, " ").trim(); return words ? words.charAt(0).toUpperCase() + words.slice(1) : name; };

/** A ring segment between two radii: the shelf's band behind its pages. */
function sectorPath(inner: number, outer: number, start: number, end: number) {
  const a = polar(outer, start); const b = polar(outer, end); const c = polar(inner, end); const d = polar(inner, start);
  const large = end - start > Math.PI ? 1 : 0;
  return `M${round(a.x)},${round(a.y)} A${outer},${outer} 0 ${large} 1 ${round(b.x)},${round(b.y)} L${round(c.x)},${round(c.y)} A${inner},${inner} 0 ${large} 0 ${round(d.x)},${round(d.y)} Z`;
}

function arcPath(radius: number, start: number, end: number) {
  const a = polar(radius, start); const b = polar(radius, end);
  return `M${round(a.x)},${round(a.y)} A${radius},${radius} 0 ${end - start > Math.PI ? 1 : 0} 1 ${round(b.x)},${round(b.y)}`;
}

/** Degree of every page: its resolved links out plus the links that point at it. */
export function degrees(pages: KnowledgeMapNode[]): Map<string, number> {
  const out = new Map<string, number>(pages.map((page) => [page.path, 0]));
  for (const page of pages) for (const link of page.links) {
    if (!link.page || !out.has(link.page) || link.page === page.path) continue;
    out.set(page.path, (out.get(page.path) || 0) + 1);
    out.set(link.page, (out.get(link.page) || 0) + 1);
  }
  return out;
}

export function layoutMap(map: Pick<KnowledgeMap, "pages" | "shelves">): MapLayout {
  const pages = map.pages.slice(0, MAX_NODES);
  const degree = degrees(pages);
  const groups = new Map<string, KnowledgeMapNode[]>();
  for (const page of pages) groups.set(page.shelf, [...(groups.get(page.shelf) || []), page]);
  const names = [...groups.keys()].sort((a, b) => a.localeCompare(b));
  const total = pages.length || 1;
  const usable = Math.PI * 2 - SHELF_GAP * names.length;
  // Every shelf gets room for at least a couple of pages, so a one-page shelf is still readable.
  const minShare = Math.min(0.06, 1 / Math.max(1, names.length));
  const shares = names.map((name) => Math.max(minShare, groups.get(name)!.length / total));
  const shareSum = shares.reduce((sum, value) => sum + value, 0) || 1;
  const shelfInfo = new Map(map.shelves.map((shelf) => [shelf.name, shelf]));

  const nodes: PlacedNode[] = []; const shelves: PlacedShelf[] = [];
  let cursor = -Math.PI / 2 + SHELF_GAP / 2;
  names.forEach((name, shelfIndex) => {
    const span = (shares[shelfIndex] / shareSum) * usable;
    const start = cursor; const end = cursor + span; cursor = end + SHELF_GAP;
    const members = [...groups.get(name)!].sort((a, b) => String(a.type || "").localeCompare(String(b.type || "")) || a.title.localeCompare(b.title));
    // Fill rings from the outside in; a ring holds as many pages as fit its arc at the spacing.
    let ring = 0; let placed = 0;
    while (placed < members.length) {
      const radius = Math.max(INNER, OUTER - ring * RING_GAP);
      const fits = Math.max(1, Math.floor((radius * span) / SPACING));
      const count = Math.min(fits, members.length - placed);
      for (let i = 0; i < count; i += 1) {
        const page = members[placed + i];
        const angle = start + (span * (i + 0.5)) / count;
        const { x, y } = polar(radius, angle);
        const d = degree.get(page.path) || 0;
        nodes.push({ ...page, x: round(x), y: round(y), r: round(4.5 + Math.min(5, Math.sqrt(d) * 1.6)), angle, degree: d, index: nodes.length });
      }
      placed += count; ring += 1;
    }
    const mid = (start + end) / 2;
    const label = polar(LABEL_RADIUS, mid);
    const cos = Math.cos(mid);
    const info = shelfInfo.get(name);
    shelves.push({ name, label: shelfLabel(name), start, end, mid, arc: arcPath(OUTER + 22, start, end), sector: sectorPath(INNER - 22, OUTER + 14, start, end), labelX: round(label.x), labelY: round(label.y), anchor: Math.abs(cos) < 0.25 ? "middle" : cos > 0 ? "start" : "end", pages: info?.pages ?? members.length, drafts: info?.drafts ?? members.filter((page) => page.status === "draft").length, stale: info?.stale ?? members.filter((page) => page.stale).length });
  });

  const byPath = new Map(nodes.map((node) => [node.path, node]));
  const links: PlacedLink[] = []; const seen = new Set<string>();
  for (const node of nodes) for (const link of node.links) {
    const target = link.page ? byPath.get(link.page) : undefined;
    if (!target || target.path === node.path) continue;
    const id = `${node.path}→${target.path}:${link.field}`;
    if (seen.has(id)) continue; seen.add(id);
    const crossShelf = target.shelf !== node.shelf;
    // Bend towards the centre: across shelves the curve passes near the middle, inside a shelf it bows gently inwards.
    const mx = (node.x + target.x) / 2; const my = (node.y + target.y) / 2;
    const pull = crossShelf ? 0.18 : 0.78;
    const cx = CENTER + (mx - CENTER) * pull; const cy = CENTER + (my - CENTER) * pull;
    links.push({ id, from: node.path, to: target.path, field: link.field, d: `M${node.x},${node.y} Q${round(cx)},${round(cy)} ${target.x},${target.y}`, crossShelf });
  }
  return { nodes, links, shelves, byPath };
}

/** One arc of the centre ring per state, sized by its share of the pages. */
export function stateRing(totals: { pages: number; drafts: number; stale: number }, radius: number): Array<{ state: NodeState; d: string }> {
  const total = Math.max(1, totals.pages);
  const parts: Array<[NodeState, number]> = [["kept", totals.pages - totals.drafts - totals.stale], ["draft", totals.drafts], ["stale", totals.stale]];
  const gap = parts.filter(([, count]) => count > 0).length > 1 ? 0.05 : 0;
  let cursor = -Math.PI / 2;
  const out: Array<{ state: NodeState; d: string }> = [];
  for (const [state, count] of parts) {
    if (count <= 0) continue;
    const span = (count / total) * Math.PI * 2;
    // A full circle cannot be one arc; draw it as two halves.
    const d = span >= Math.PI * 2 - 0.001 ? `${arcPath(radius, -Math.PI / 2, Math.PI / 2)} ${arcPath(radius, Math.PI / 2, Math.PI * 1.5 - 0.0001).replace(/^M/, "M")}` : arcPath(radius, cursor, cursor + Math.max(0.01, span - gap));
    out.push({ state, d });
    cursor += span;
  }
  return out;
}

/** The busiest pages, labelled even when nothing is picked so the map has landmarks. */
export function landmarks(layout: MapLayout, count = 8): Set<string> {
  // Labels are horizontal, so two hubs on about the same row would print over each other; the busier one keeps its label.
  const clash = (a: PlacedNode, b: PlacedNode) => Math.abs(a.y - b.y) < 24 && Math.abs(a.x - b.x) < 160;
  const picked: PlacedNode[] = [];
  for (const node of [...layout.nodes].filter((item) => item.degree >= 3).sort((a, b) => b.degree - a.degree || a.title.localeCompare(b.title))) {
    if (picked.length >= count) break;
    if (!picked.some((other) => clash(other, node))) picked.push(node);
  }
  return new Set(picked.map((node) => node.path));
}

/** The pages one page links to and the pages that link to it, with the field of each link. */
export function neighbourhood(layout: MapLayout, path: string): { out: Array<{ field: string; path: string }>; in: Array<{ field: string; path: string }>; paths: Set<string> } {
  const out = layout.links.filter((link) => link.from === path).map((link) => ({ field: link.field, path: link.to }));
  const incoming = layout.links.filter((link) => link.to === path).map((link) => ({ field: link.field, path: link.from }));
  return { out, in: incoming, paths: new Set([path, ...out.map((item) => item.path), ...incoming.map((item) => item.path)]) };
}

/** Pages whose title, path, type or a field value contain every word of the query. */
export function searchNodes(nodes: KnowledgeMapNode[], query: string, limit = 8): KnowledgeMapNode[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return nodes.filter((node) => {
    const text = [node.title, node.path, node.type, node.owner, ...Object.values(node.fields), ...node.links.map((link) => link.target)].filter(Boolean).join(" ").toLowerCase();
    return words.every((word) => text.includes(word));
  }).slice(0, limit);
}

export const FIELD_LABEL: Record<string, string> = {
  upstream: "Upstream", downstream: "Downstream", pipelines: "Pipelines", brands: "Brands", markets: "Markets", stakeholders: "Stakeholders",
  vendor: "Vendor", owner: "Owner", asked_by: "Asked by", uses: "Uses", applies_to: "Applies to", systems: "Systems", refs: "Reads live", related: "Related", supersedes: "Replaces",
  sla: "SLA", tier: "Tier", response: "Response", journey: "Journey", era: "Era", stale_after: "Review by", expected: "Expected",
};
export const fieldLabel = (field: string) => FIELD_LABEL[field] || shelfLabel(field);

/** The state a page is in, for its colour and word: a draft waits for review, a stale page is past its review date. */
export type NodeState = "draft" | "stale" | "kept";
export const nodeState = (node: Pick<KnowledgeMapNode, "status" | "stale">): NodeState => (node.status === "draft" ? "draft" : node.stale ? "stale" : "kept");

import type { LucideIcon } from "lucide-react";

/** The graph FlowGraph draws, and where each node goes: pure, so it is tested without rendering. */

export type FlowTone = "neutral" | "good" | "bad" | "warning" | "focus" | "muted";
export interface FlowNode {
  id: string;
  title: string;
  subtitle?: string | null;
  /** Fixed column; nodes without one are placed one column after their furthest parent. */
  column?: number;
  tone?: FlowTone;
  icon?: LucideIcon;
  /** A short word at the right of the title row: "Failed", "3 rows", "Ruled out". */
  badge?: string | null;
}
export interface FlowEdge { from: string; to: string; tone?: FlowTone; dashed?: boolean }

export const NODE_W = 196;
export const NODE_H = 60;
export const COL_GAP = 44;
export const ROW_GAP = 14;
export const HEAD = 28;

/** Columns and rows for every node: pure, so it can be tested without rendering. */
export function layoutFlow(nodes: FlowNode[], edges: FlowEdge[]): { positions: Map<string, { column: number; row: number }>; columns: number; rows: number } {
  const ids = new Set(nodes.map((node) => node.id));
  const valid = edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to) && edge.from !== edge.to);
  const column = new Map<string, number>();
  for (const node of nodes) column.set(node.id, node.column ?? 0);
  // Longest path from a root, relaxed at most once per node so a cycle cannot loop forever.
  for (let pass = 0; pass < nodes.length; pass += 1) {
    let moved = false;
    for (const edge of valid) {
      const target = nodes.find((node) => node.id === edge.to);
      if (target?.column !== undefined) continue;
      const next = (column.get(edge.from) ?? 0) + 1;
      if (next > (column.get(edge.to) ?? 0)) { column.set(edge.to, next); moved = true; }
    }
    if (!moved) break;
  }
  const columns = Math.max(0, ...column.values()) + 1;
  const byColumn: string[][] = Array.from({ length: columns }, () => []);
  for (const node of nodes) byColumn[column.get(node.id) ?? 0].push(node.id);
  // One pass that orders each column by where its parents sit, so edges cross less.
  const row = new Map<string, number>();
  byColumn.forEach((ids, index) => {
    if (index > 0) {
      const weight = (id: string) => { const parents = valid.filter((edge) => edge.to === id && row.has(edge.from)).map((edge) => row.get(edge.from) as number); return parents.length ? parents.reduce((sum, value) => sum + value, 0) / parents.length : Number.POSITIVE_INFINITY; };
      const original = new Map(ids.map((id, position) => [id, position]));
      ids.sort((a, b) => { const wa = weight(a); const wb = weight(b); return wa === wb ? (original.get(a) as number) - (original.get(b) as number) : wa - wb; });
    }
    ids.forEach((id, position) => row.set(id, position));
  });
  const rows = Math.max(1, ...byColumn.map((ids) => ids.length));
  const positions = new Map<string, { column: number; row: number }>();
  byColumn.forEach((ids, index) => { const offset = (rows - ids.length) / 2; ids.forEach((id, position) => positions.set(id, { column: index, row: position + offset })); });
  return { positions, columns, rows };
}


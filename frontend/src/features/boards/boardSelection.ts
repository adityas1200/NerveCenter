import type { BoardWidget, WidgetCell } from "@/api/boards";
import type { AgentSelection } from "@/components/ops/agentPanelContext";

/**
 * What a person points at on a board, as the selection the Sonic panel sends (SPEC-tasks-12 FR-3): the board,
 * the widget, the filters on screen and the picked point, so Sonic reads the same data back. Pure.
 */

/** A picked chart bucket (its label and each series' value there) or a picked table row. */
export type WidgetPoint = { label: string; values: Record<string, WidgetCell> } | { row: Record<string, WidgetCell> };

const MAX_ROW_COLUMNS = 12;
const MAX_CELL = 120;
const cut = (value: WidgetCell): WidgetCell => (typeof value === "string" && value.length > MAX_CELL ? `${value.slice(0, MAX_CELL - 1)}…` : value ?? null);

export function chartPoint(label: string, series: Array<{ name: string; values: number[] }>, index: number): WidgetPoint {
  return { label, values: Object.fromEntries(series.map((item) => [item.name, item.values[index] ?? null])) };
}

export function rowPoint(columns: string[], row: WidgetCell[]): WidgetPoint {
  return { row: Object.fromEntries(columns.slice(0, MAX_ROW_COLUMNS).map((column, index) => [column, cut(row[index] ?? null)])) };
}

const shown = (value: WidgetCell) => (value === null || value === undefined || value === "" ? "—" : typeof value === "number" ? value.toLocaleString() : String(value));

/** "09/24 · Failed 3, Succeeded 12" for a bucket; the first three cells for a row. */
export function pointLabel(point: WidgetPoint): string {
  if ("row" in point) return Object.values(point.row).slice(0, 3).map(shown).join(" · ");
  const values = Object.entries(point.values).map(([name, value]) => `${name} ${shown(value)}`).join(", ");
  return values ? `${point.label} · ${values}` : point.label;
}

export function widgetSelection(board: { id: string; title: string }, widget: Pick<BoardWidget, "id" | "title" | "type">, filters: Record<string, unknown>, point: WidgetPoint | null): AgentSelection {
  return {
    kind: "board_widget",
    id: `${board.id}/${widget.id}`,
    title: point ? `${widget.title} · ${pointLabel(point)}` : widget.title,
    detail: { boardId: board.id, boardTitle: board.title, widgetId: widget.id, widgetTitle: widget.title, widgetType: widget.type, filters, ...(point ? { point } : {}) },
  };
}

/** The question typed into the box; the person edits it to say what looks wrong before sending (FR-9). */
export function widgetPrompt(widget: Pick<BoardWidget, "title">, point: WidgetPoint | null): string {
  return point ? `Explain ${pointLabel(point)} in "${widget.title}" and check whether it is right.` : `Explain what "${widget.title}" shows and check whether it is right.`;
}

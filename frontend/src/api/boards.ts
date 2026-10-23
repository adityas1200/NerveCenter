import { apiClient } from "@/api/client";

/**
 * Boards: dashboards people build with Sonic and publish for everyone. A board is a saved spec
 * (filters and widgets); the backend computes every widget's data, the frontend only draws it.
 */

export type BoardStatus = "draft" | "published";
export type BoardRangePreset = "today" | "12h" | "24h" | "7d" | "30d" | "custom";
export type WidgetType = "metric" | "table" | "chart" | "text";
export type WidgetSize = "sm" | "md" | "lg";

export interface BoardOwner { id: string; name: string }

export interface BoardFilter {
  key: string;
  label: string;
  type: "range" | "select" | "text";
  /** Select filters only. */
  options?: string[];
  /** Range: a preset. Select: an option or "all". Text: the starting value. */
  default: string;
  /** Select filters: the label of the "all" option. */
  allLabel?: string;
  placeholder?: string;
}

export interface WidgetSource {
  kind: "nervecenter" | "sql" | "text";
  /** nervecenter: the source id, such as `pipelines.health`. */
  query?: string;
  params?: Record<string, string>;
  /** sql */
  provider?: string;
  statement?: string;
  catalog?: string;
  schema?: string;
  /** text */
  markdown?: string;
}

/** How a chart widget draws its rows; the backend defaults to "column". */
export type ChartKind = "column" | "bar" | "line" | "area" | "donut" | "pie" | "heatmap" | "funnel" | "gantt";
export const CHART_KINDS: ChartKind[] = ["column", "bar", "line", "area", "donut", "pie", "heatmap", "funnel", "gantt"];

export interface WidgetViz {
  valueColumn?: string | null;
  labelColumn?: string | null;
  suffix?: string | null;
  tone?: "neutral" | "good" | "bad" | "warning" | "auto";
  /** Metric: a 60×20 trend under the number when the result has a Period column and one numeric column. */
  sparkline?: boolean;
  chart?: ChartKind;
  /** Chart: the value on each mark (slices from 8% up, bars at their end, points at drawn labels). */
  showValues?: boolean;
  xColumn?: string | null;
  seriesColumns?: string[];
  layout?: "stacked" | "grouped";
  /** Chart: the unit of the values, e.g. "runs". */
  unit?: string;
  /** Heatmap: which way is worse; `pivotColumn` turns long rows (row, column, value) into the grid. */
  scale?: "high_is_bad" | "high_is_good" | "neutral";
  pivotColumn?: string;
  /** Gantt: ISO start and end, run state and bar label columns; default Started, Ended, Status. */
  startColumn?: string;
  endColumn?: string;
  stateColumn?: string;
  /** Metric: the value as a ring against a target. */
  gauge?: { max: number; target: number | null; higherIsBetter: boolean };
  columns?: string[];
  statusColumn?: string | null;
  limit?: number;
}

export interface BoardWidget {
  id: string;
  type: WidgetType;
  title: string;
  size: WidgetSize;
  note?: string | null;
  source: WidgetSource;
  viz?: WidgetViz;
}

export interface BoardSummary {
  id: string;
  title: string;
  description: string;
  status: BoardStatus;
  owner: BoardOwner;
  widgets: number;
  filters: number;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  views: number;
  canEdit: boolean;
}

export interface Board extends Omit<BoardSummary, "widgets" | "filters"> {
  filters: BoardFilter[];
  widgets: BoardWidget[];
}

export type WidgetCell = string | number | null;

export interface WidgetResult {
  columns?: string[];
  rows?: WidgetCell[][];
  markdown?: string;
  /** Where the numbers came from: "Pipelines", "databricks SQL". */
  source?: string;
  total?: number;
  /** Per column, a route per row; the cell becomes a link. */
  links?: Record<string, string[]>;
  at: string;
  /** A plain sentence; the widget failed but the board did not. */
  error?: string;
}

/** The latest fix Sonic applied to the table behind a widget, and how its verification went (SPEC-tasks-13 FR-18). */
export interface BoardFix { taskId: string; proposalId: string; title: string; status: "passed" | "failed" | "inconclusive" | string; appliedAt: string }

export interface BoardData {
  boardId: string;
  filters: { range: { preset: BoardRangePreset; from: string; to: string } } & Record<string, unknown>;
  widgets: Record<string, WidgetResult>;
  /** Missing from backends before SPEC-tasks-13. */
  fixes?: Record<string, BoardFix>;
}

export interface BoardSource { id: string; title: string; columns: string[]; honours: string[]; fits: WidgetType[]; description: string }

export interface BoardSources { sources: BoardSource[]; widgetTypes: WidgetType[]; sizes: WidgetSize[]; ranges: BoardRangePreset[] }

export interface BoardInput { title?: string; description?: string; filters?: Partial<BoardFilter>[]; widgets?: Partial<BoardWidget>[] }

/** What the reader picked: the range preset (plus from/to for custom) and one value per filter key. */
export type BoardFilterValues = { range?: string; from?: string; to?: string } & Record<string, string | undefined>;

export interface WidgetPreview extends Omit<WidgetResult, "at"> { widget: BoardWidget; filters: BoardData["filters"] }

const boardPath = (id: string) => `/api/boards/${encodeURIComponent(id)}`;

export const boardsApi = {
  list: (signal?: AbortSignal) => apiClient.get<{ items: BoardSummary[] }>("/api/boards", { signal }),
  sources: (signal?: AbortSignal) => apiClient.get<BoardSources>("/api/boards/sources", { signal }),
  get: (id: string, signal?: AbortSignal) => apiClient.get<Board>(boardPath(id), { signal }),
  create: (input: BoardInput) => apiClient.post<Board>("/api/boards", input),
  update: (id: string, input: BoardInput) => apiClient.put<Board>(boardPath(id), input),
  publish: (id: string) => apiClient.post<Board>(`${boardPath(id)}/publish`),
  unpublish: (id: string) => apiClient.post<Board>(`${boardPath(id)}/unpublish`),
  remove: (id: string) => apiClient.delete<{ id: string; deleted: boolean }>(boardPath(id)),
  /** `countView` is false on refetches so a filter change does not count as another view. */
  data: (id: string, filters: BoardFilterValues, { countView = true }: { countView?: boolean } = {}, signal?: AbortSignal) =>
    apiClient.post<BoardData>(`${boardPath(id)}/data${countView ? "" : "?view=0"}`, { filters }, { signal }),
  preview: (widget: Partial<BoardWidget>, filters?: BoardFilterValues, board?: Partial<Board>) =>
    apiClient.post<WidgetPreview>("/api/boards/preview", { widget, filters, board }),
};

export const boardKeys = {
  all: ["boards"] as const,
  list: () => ["boards", "list"] as const,
  sources: () => ["boards", "sources"] as const,
  detail: (id: string) => ["boards", "detail", id] as const,
  data: (id: string, filters: BoardFilterValues) => ["boards", "detail", id, "data", filters] as const,
};

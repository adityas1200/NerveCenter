import { useMemo, useState } from "react";
import { STATUS_TONE_RANK, statusMeta } from "@/components/ops/OperationalStatus";
import { priorityRank } from "@/components/ops/PriorityBadge";

export type SortDir = "asc" | "desc";

export interface SortState<K extends string = string> {
  key: K;
  dir: SortDir;
}

export type Comparator<T> = (left: T, right: T) => number;

type Getter<T, V> = (row: T) => V;

export const byText = <T,>(get: Getter<T, string | null | undefined>): Comparator<T> => (left, right) =>
  String(get(left) ?? "").localeCompare(String(get(right) ?? ""), undefined, { sensitivity: "base", numeric: true });

/** Newest first when ascending, because that is what people mean by "sort by updated". */
export const byDate = <T,>(get: Getter<T, string | null | undefined>): Comparator<T> => (left, right) => {
  const l = Date.parse(String(get(left) ?? ""));
  const r = Date.parse(String(get(right) ?? ""));
  return (Number.isNaN(r) ? Number.NEGATIVE_INFINITY : r) - (Number.isNaN(l) ? Number.NEGATIVE_INFINITY : l);
};

export const byPriority = <T,>(get: Getter<T, string | null | undefined>): Comparator<T> => (left, right) =>
  priorityRank(get(left)) - priorityRank(get(right));

/** Problems first, finished work last. */
export const byStatus = <T,>(get: Getter<T, string | null | undefined>): Comparator<T> => (left, right) =>
  STATUS_TONE_RANK[statusMeta(get(left)).tone] - STATUS_TONE_RANK[statusMeta(get(right)).tone];

export function useTableSort<T, K extends string>(rows: T[], comparators: Record<K, Comparator<T>>, initial: SortState<K>) {
  const [sort, setSort] = useState<SortState<K>>(initial);
  const sorted = useMemo(() => {
    const compare = comparators[sort.key];
    if (!compare) return rows;
    const direction = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((left, right) => compare(left, right) * direction);
  }, [rows, sort, comparators]);
  const toggle = (key: K) => setSort((current) => current.key === key ? { key, dir: current.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" });
  return { rows: sorted, sort, toggle };
}

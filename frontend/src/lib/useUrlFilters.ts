import { useSearchParams } from "react-router-dom";

/** The value of a filter that is off. */
export const ALL = "all";

/** The options, plus the current value when it is not among them (a filter link to something not listed). */
export function withCurrent(values: string[], current: string, all = ALL): string[] {
  return current !== all && !values.includes(current) ? [...values, current] : values;
}

/**
 * List filters that live in the URL, so a filtered view can be linked and survives a reload. Changes
 * replace the history entry. `set` drops the param when the value is empty or the default ("all"),
 * keeping the URL clean; several changes at once go through `update`, because each `set` starts from
 * the params of the render it was made in, so two in a row would lose the first.
 */
export function useUrlFilters() {
  const [params, setParams] = useSearchParams();
  /** Change a copy of the params in place; `replace: false` adds a history entry. */
  const update = (change: (next: URLSearchParams) => void, replace = true) => {
    const next = new URLSearchParams(params);
    change(next);
    setParams(next, replace ? { replace: true } : undefined);
  };
  const set = (key: string, value: string | null, defaultValue = "all") => update((next) => {
    if (value === null || value === "" || value === defaultValue) next.delete(key);
    else next.set(key, value);
  });
  const clear = (...keys: string[]) => update((next) => { for (const key of keys) next.delete(key); });
  /** Swap the whole query string. */
  const replaceAll = (next: URLSearchParams) => setParams(next, { replace: true });
  return { params, get: (key: string) => params.get(key), set, clear, update, replaceAll };
}

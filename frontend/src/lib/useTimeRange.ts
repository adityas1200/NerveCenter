import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  decodeRange,
  encodeRange,
  periodLabel,
  periodNoun,
  previousBounds,
  rangeBounds,
  rangeTitle,
  readStoredRange,
  storeRange,
  type RangeState,
} from "@/lib/timeRange";

export const RANGE_PARAM = "range";

/**
 * One reporting window for the whole app. The URL wins when it carries `range=`
 * (deep links from tiles), otherwise the last choice is restored from storage,
 * so moving between screens keeps the same period.
 */
export function useTimeRange() {
  const [searchParams, setSearchParams] = useSearchParams();
  const fromUrl = decodeRange(searchParams.get(RANGE_PARAM));
  const [stored, setStored] = useState<RangeState>(readStoredRange);
  const range = fromUrl ?? stored;

  useEffect(() => {
    if (fromUrl) { storeRange(fromUrl); setStored(fromUrl); }
  }, [fromUrl?.preset, fromUrl?.from, fromUrl?.to]); // eslint-disable-line react-hooks/exhaustive-deps

  const setRange = useCallback((next: RangeState) => {
    storeRange(next);
    setStored(next);
    const params = new URLSearchParams(searchParams);
    params.set(RANGE_PARAM, encodeRange(next));
    setSearchParams(params, { replace: true });
  }, [searchParams, setSearchParams]);

  const bounds = useMemo(() => rangeBounds(range), [range.preset, range.from, range.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const previous = useMemo(() => previousBounds(range), [range.preset, range.from, range.to]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    range,
    setRange,
    bounds,
    previous,
    label: periodLabel(range),
    noun: periodNoun(range),
    title: rangeTitle(range),
    /** Append to a `to=` path so the destination opens on the same window. */
    param: `${RANGE_PARAM}=${encodeURIComponent(encodeRange(range))}`,
  };
}

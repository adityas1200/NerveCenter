import { bucketIndex, bucketUnit, makeBuckets } from "./timeBuckets";

const HOUR = 3600 * 1000;
const NOW = Date.parse("2026-09-23T12:30:00Z");

describe("makeBuckets", () => {
  it("buckets a day by hour and a week by day", () => {
    expect(bucketUnit(24 * HOUR)).toBe("hour");
    expect(bucketUnit(7 * 24 * HOUR)).toBe("day");
    expect(bucketUnit(90 * 24 * HOUR)).toBe("week");
    const day = makeBuckets({ from: new Date(NOW - 24 * HOUR).toISOString(), to: null }, NOW);
    expect(day.length).toBeGreaterThanOrEqual(24);
    expect(day.length).toBeLessThanOrEqual(25);
    const week = makeBuckets({ from: new Date(NOW - 7 * 24 * HOUR).toISOString(), to: null }, NOW);
    expect(week.length).toBeGreaterThanOrEqual(7);
    expect(week.length).toBeLessThanOrEqual(8);
  });

  it("falls back to the last seven days when there is no start", () => {
    expect(makeBuckets({ from: null, to: null }, NOW).length).toBeGreaterThanOrEqual(7);
  });

  it("places timestamps in the right bucket and rejects ones outside the window", () => {
    const buckets = makeBuckets({ from: new Date(NOW - 24 * HOUR).toISOString(), to: null }, NOW);
    const inside = new Date(NOW - 2 * HOUR).toISOString();
    const index = bucketIndex(buckets, inside);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(Date.parse(inside)).toBeGreaterThanOrEqual(buckets[index].start);
    expect(Date.parse(inside)).toBeLessThan(buckets[index].end);
    expect(bucketIndex(buckets, new Date(NOW - 48 * HOUR).toISOString())).toBe(-1);
    expect(bucketIndex(buckets, null)).toBe(-1);
  });
});

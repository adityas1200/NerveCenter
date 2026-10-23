import { describe, expect, it } from "vitest";
import { autoRefreshSeconds } from "./autoRefresh";

describe("SPEC-platform-page-auto-refresh FR-1", () => {
  it.each([undefined, "", " ", "no", "-1", "1.5", "Infinity", "9007199254740992"])("uses five minutes for missing/invalid %s", raw => {
    expect(autoRefreshSeconds(raw)).toBe(300);
  });
  it("accepts custom seconds and zero to disable", () => {
    expect(autoRefreshSeconds("45")).toBe(45);
    expect(autoRefreshSeconds(" 600 ")).toBe(600);
    expect(autoRefreshSeconds("0")).toBe(0);
  });
});

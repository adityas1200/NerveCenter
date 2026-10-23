import { describe, expect, it } from "vitest";
import { apiClient } from "./client";
import { jsonResponse, mockFetch } from "@/test/utils";

describe("SPEC-platform-07 FR-3/FR-9: API response contract", () => {
  it("keeps successful resource bodies direct", async () => {
    mockFetch(() => jsonResponse({ id: "T-1", status: "queued" }));
    await expect(apiClient.get("/api/tasks/T-1")).resolves.toEqual({ id: "T-1", status: "queued" });
  });

  it("preserves a stable error code and message for callers", async () => {
    const body = { error: "The ticket changed. Refresh and try again.", code: "CONFLICT" };
    mockFetch(() => jsonResponse(body, 409));
    await expect(apiClient.post("/api/tickets", {})).rejects.toMatchObject({
      status: 409,
      code: "CONFLICT",
      message: body.error,
      details: body,
    });
  });
});

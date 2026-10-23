import { describe, expect, it } from "vitest";
import { apiClient } from "./client";
import { jsonResponse, mockFetch } from "@/test/utils";

const htmlPage = (status: number) =>
  Promise.resolve(
    new Response("<html><head><title>413 Request Entity Too Large</title></head><body>nginx</body></html>", {
      status,
      headers: { "content-type": "text/html" },
    }),
  );

describe("SPEC-platform-07 FR-3: errors from the proxy in front of the backend", () => {
  it("names a too-large message instead of showing nginx's HTML page", async () => {
    mockFetch(() => htmlPage(413));
    await expect(apiClient.post("/api/tasks", { attachments: [] })).rejects.toMatchObject({
      status: 413,
      message: "This is too large to send. Attach smaller files, or fewer at once.",
    });
  });

  it("keeps the backend's own JSON message for the same status", async () => {
    mockFetch(() => jsonResponse({ error: "Request body exceeds 8388608 byte limit" }, 413));
    await expect(apiClient.post("/api/tasks", {})).rejects.toMatchObject({
      status: 413,
      message: "Request body exceeds 8388608 byte limit",
    });
  });

  it("never puts HTML in the message for other proxy errors", async () => {
    mockFetch(() => htmlPage(502));
    await expect(apiClient.get("/api/tasks")).rejects.toMatchObject({
      status: 502,
      message: "NerveCenter is not reachable right now. Try again in a minute.",
    });
  });
});

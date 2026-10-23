import { act, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "@/components/ui";
import { DataQualityPage } from "./DataQualityPage";
import { jsonResponse, mockFetch, renderWithClient } from "@/test/utils";

const configuration = { id: "dq-1", provider: "databricks", catalog: "ops", schema: "dq", resultTable: "results", enabled: true, mapping: { checkId: "check_id", checkName: "check_name", status: "status", executedAt: "executed_at" } };

describe("DataQualityPage refresh cadence (SPEC-data-quality-02 FR-15)", () => {
  it("does not refresh on timers or visibility changes", async () => {
    const calls: string[] = [];
    const fetchMock = mockFetch((url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.includes("/api/monitor/refresh")) return jsonResponse({ status: {} });
      if (url.includes("/api/data-quality/providers")) return jsonResponse({ items: [{ id: "databricks", name: "Databricks", source: "deployment" }] });
      if (url.endsWith("/api/data-quality/config")) return jsonResponse({ configuration, tables: [configuration] });
      if (url.includes("/api/data-quality/monitor?")) return jsonResponse({ configured: true, configuration, providers: [], range: "Last 24 hours", from: null, fetchedAt: new Date().toISOString(), source: { mode: "configured", platform: "databricks", label: "results", reason: "ok" }, summary: { total: 0, passed: 0, failed: 0, warning: 0, unreported: 0 }, items: [], total: 0, offset: 0, limit: 10 });
      return jsonResponse({ items: [] });
    });
    const originalVisibility = document.visibilityState;
    const setVisibility = (state: "visible" | "hidden") => Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
    setVisibility("visible");
    const restoreVisibility = () => Object.defineProperty(document, "visibilityState", { configurable: true, value: originalVisibility });

    try {
      renderWithClient(<MemoryRouter initialEntries={["/data-quality"]}><ToastProvider><DataQualityPage /></ToastProvider></MemoryRouter>);
      await screen.findByText("Data quality");
      await vi.waitFor(() => expect(calls.filter((call) => call.startsWith("POST") && call.includes("/api/monitor/refresh"))).toHaveLength(0));
      await vi.waitFor(() => expect(calls.filter((call) => call.includes("/api/data-quality/monitor?")).length).toBe(1));

      vi.useFakeTimers();
      const postCount = () => calls.filter((call) => call.startsWith("POST") && call.includes("/api/monitor/refresh")).length;
      const readCount = () => calls.filter((call) => call.includes("/api/data-quality/monitor?")).length;
      const initialPosts = postCount();
      const initialReads = readCount();
      setVisibility("hidden");
      await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
      expect(postCount()).toBe(initialPosts);
      expect(readCount()).toBe(initialReads);

      setVisibility("visible");
      await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await Promise.resolve(); });
      await vi.waitFor(() => expect(postCount()).toBe(initialPosts));
      await vi.waitFor(() => expect(readCount()).toBe(initialReads));

      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
      await vi.waitFor(() => expect(postCount()).toBe(initialPosts));
      await vi.waitFor(() => expect(readCount()).toBe(initialReads));
      expect(fetchMock.mock.calls.filter(([url, init]) => String(url).includes("/api/monitor/refresh") && init?.method === "POST")).toHaveLength(initialPosts);
    } finally {
      vi.useRealTimers();
      restoreVisibility();
    }
  });
});

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { queryKeys } from "@/api/queryKeys";
import type { Operations } from "@/api/settings";
import { ToastProvider } from "@/components/ui";
import { jsonResponse, mockFetch, renderWithClient } from "@/test/utils";
import { PipelinesTab } from "./PipelinesTab";

// SPEC-pipelines-03 FR-8: saving a platform or its job filter refetches pipelines, so the Pipelines page needs no manual refresh.
const operations = {
  connections: { databricks: { kind: "mcp" } },
  platforms: [{ name: "commercial-databricks", type: "databricks", connection: "databricks", environments: { prod: { workspace: "https://adb-1.azuredatabricks.net" } }, monitoring: { jobs: { include: [], exclude: [] } } }],
} as unknown as Operations;

function serve(refresh: () => Promise<Response>) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  mockFetch((url, init) => {
    const method = init?.method || "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.includes("/api/monitor/refresh")) return refresh();
    if (url.includes("/api/settings/") && method === "PUT") return jsonResponse({ section: "platforms", value: {}, validation: { errors: [], warnings: [] } });
    if (url.includes("/api/connectors")) return jsonResponse({ items: [{ id: "databricks", name: "Databricks", state: "connected", configured: true, kind: "catalog", settings: {}, secretsSet: [], mcp: null, description: "" }] });
    return jsonResponse({ items: [] });
  });
  return calls;
}

async function saveFilter(include: string) {
  const view = renderWithClient(<MemoryRouter><ToastProvider><PipelinesTab operations={operations} /></ToastProvider></MemoryRouter>);
  // A cached Pipelines page, as if the person had opened it before coming to Settings.
  view.client.setQueryData(queryKeys.monitor.list({ limit: 100 }), { items: [] });
  await userEvent.click(screen.getByRole("button", { name: "Edit commercial-databricks" }));
  const dialog = await screen.findByRole("dialog");
  await userEvent.type(within(dialog).getByRole("textbox", { name: "Show only jobs named" }), include);
  await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  return view;
}

describe("Settings > Pipelines save", () => {
  it("FR-8: after the save, asks the server to fetch pipelines and marks the Pipelines page stale", async () => {
    const calls = serve(() => jsonResponse({ status: {} }));
    const { client } = await saveFilter("sales");
    await waitFor(() => expect(calls.some((call) => call.url.includes("/api/monitor/refresh"))).toBe(true));
    const put = calls.findIndex((call) => call.method === "PUT" && call.url.endsWith("/api/settings/platforms"));
    const refresh = calls.findIndex((call) => call.url.includes("/api/monitor/refresh"));
    expect(put).toBeGreaterThanOrEqual(0);
    expect(refresh).toBeGreaterThan(put);
    expect(calls[refresh]).toMatchObject({ method: "POST", body: { sources: ["pipelines"] } });
    await waitFor(() => expect(client.getQueryState(queryKeys.monitor.list({ limit: 100 }))?.isInvalidated).toBe(true));
  });

  it("FR-8: a refresh refused within 30 seconds still saves and says when the page updates", async () => {
    const calls = serve(() => jsonResponse({ error: "Refreshed a moment ago. Try again in half a minute." }, 429));
    const { client } = await saveFilter("sales");
    expect(await screen.findByText("Pipelines update at the next fetch")).toBeInTheDocument();
    expect(calls.some((call) => call.method === "PUT" && call.url.endsWith("/api/settings/platforms"))).toBe(true);
    expect(client.getQueryState(queryKeys.monitor.list({ limit: 100 }))?.isInvalidated).toBe(true);
  });
});

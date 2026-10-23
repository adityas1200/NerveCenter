import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { Operations } from "@/api/settings";
import { ToastProvider } from "@/components/ui";
import { jsonResponse, mockFetch, renderWithClient } from "@/test/utils";
import { DataQualityTab } from "./DataQualityTab";
import { PipelinesTab } from "./PipelinesTab";

const table = { id: "dq-1", name: "Warehouse checks", provider: "snowflake", catalog: "DW", schema: "QUALITY", resultTable: "DQ_LOG", mapping: { checkId: "check_id", status: "status", executedAt: "run_at" }, enabled: true };
const operations = {
  connections: { databricks: { kind: "mcp" } },
  platforms: [{ name: "warehouse-jobs", type: "databricks", connection: "databricks", environments: { default: { workspace: "https://adb-1.azuredatabricks.net" } } }],
} as unknown as Operations;

describe("Settings removal failures", () => {
  it("keeps the Data Quality confirmation open and shows the delete error", async () => {
    mockFetch((url, init) => {
      if (url.includes("/api/data-quality/providers")) return jsonResponse({ items: [{ id: "snowflake", name: "Snowflake", source: "managed" }] });
      if (url.includes("/api/data-quality/config") && init?.method === "DELETE") return jsonResponse({ error: "The result table is still in use." }, 409);
      if (url.includes("/api/data-quality/config")) return jsonResponse({ configuration: table, tables: [table] });
      return jsonResponse({ items: [] });
    });
    renderWithClient(<MemoryRouter><ToastProvider><DataQualityTab /></ToastProvider></MemoryRouter>);

    await userEvent.click(await screen.findByRole("button", { name: "Remove Warehouse checks" }));
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    expect(await screen.findByText("Not removed")).toBeInTheDocument();
    expect(await screen.findByText("The result table is still in use.")).toBeInTheDocument();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("keeps the Pipelines confirmation open and shows the settings error", async () => {
    mockFetch((url, init) => {
      if (url.includes("/api/settings/platforms") && init?.method === "PUT") return jsonResponse({ error: "Settings could not be saved." }, 500);
      if (url.includes("/api/connectors")) return jsonResponse({ items: [] });
      return jsonResponse({ items: [] });
    });
    renderWithClient(<MemoryRouter><ToastProvider><PipelinesTab operations={operations} /></ToastProvider></MemoryRouter>);

    await userEvent.click(await screen.findByRole("button", { name: "Remove warehouse-jobs" }));
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    expect(await screen.findByText("Settings not saved")).toBeInTheDocument();
    expect(await screen.findByText("Settings could not be saved.")).toBeInTheDocument();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument());
  });
});

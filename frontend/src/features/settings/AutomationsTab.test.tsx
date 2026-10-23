import { fireEvent, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "@/components/ui";
import { AutomationsTab } from "./AutomationsTab";
import { jsonResponse, mockFetch, renderWithClient } from "@/test/utils";

// SPEC-automations-01 FR-40: the Automations tab shows the project's automation and saves it in one section.

const legacy = {
  enabled: true, legacy: true,
  limits: { maxConcurrent: 3, maxPerDay: 50, cooldownMinutes: 30, reopenHours: 24 },
  ticket: { platform: "auto", priority: "auto", assignmentGroup: "", projectKey: "", issueType: "Task", onRecovery: "comment" },
  pipelineFailed: { action: "ticket", permission: "read-only", playbook: "", platforms: ["databricks"] },
  pipelineLate: { action: "off", permission: "read-only", playbook: "", graceMinutes: 15, lookbackHours: 24, notStarted: true, missedSlots: true, longRunning: false, longRunningFactor: 2 },
  dqFailed: { action: "off", permission: "read-only", playbook: "", minSeverity: "high", includeWarnings: false, tables: [] },
  overrides: { pipelines: {}, tables: {} },
  updatedBy: null,
};
const status = { sources: { pipelines: { everySeconds: 300, lastFetchAt: new Date(Date.now() - 120_000).toISOString(), nextFetchAt: new Date(Date.now() + 180_000).toISOString(), lastError: null }, dataQuality: { everySeconds: 900, lastFetchAt: null, nextFetchAt: null, lastError: "The result tables could not be read" } }, automation: { active: true, legacy: true, watchedWhenIdle: true, syncEnabled: true }, openAlerts: 2 };

function setup(config: Record<string, unknown> = legacy) {
  const puts: Array<{ url: string; body: Record<string, unknown> }> = [];
  mockFetch((url, init) => {
    if (url.includes("/api/settings/automation") && init?.method === "PUT") { puts.push({ url, body: JSON.parse(String(init.body)) }); return jsonResponse({ section: "automation", value: {} }); }
    if (url.includes("/api/automation")) return jsonResponse({ config, status });
    if (url.includes("/api/pipelines")) return jsonResponse({ items: [{ pipelineId: "42", name: "sales_load", status: "healthy" }] });
    if (url.includes("/api/data-quality/config")) return jsonResponse({ configuration: null, tables: [] });
    return jsonResponse({ items: [] });
  });
  renderWithClient(<MemoryRouter><ToastProvider><AutomationsTab /></ToastProvider></MemoryRouter>);
  return puts;
}

describe("AutomationsTab", () => {
  it("says a legacy project runs the earlier rule and shows when each source was fetched", async () => {
    setup();
    expect(await screen.findByText(/uses the earlier rule: a NerveCenter ticket for each failed Databricks run/)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Pipeline failed: what happens" })).toHaveTextContent("Ticket only");
    expect(screen.getByText(/Fetched 2m ago/)).toBeInTheDocument();
    expect(screen.getByText("The result tables could not be read")).toBeInTheDocument();
    expect(screen.getByText("Not saved yet")).toBeInTheDocument();
  });

  it("saves a trigger change as the automation section, without the legacy platform list", async () => {
    const puts = setup();
    fireEvent.click(await screen.findByRole("combobox", { name: "Pipeline late or missed: what happens" }));
    fireEvent.click(await screen.findByRole("option", { name: "Investigate" }));
    fireEvent.change(screen.getByLabelText("Grace, minutes"), { target: { value: "20" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[0]);
    await waitFor(() => expect(puts).toHaveLength(1));
    const body = puts[0].body as { pipelineFailed: Record<string, unknown>; pipelineLate: Record<string, unknown>; limits: Record<string, unknown> };
    expect(body.pipelineLate).toMatchObject({ action: "task", graceMinutes: 20, permission: "read-only" });
    expect(body.pipelineFailed).toEqual({ action: "ticket", permission: "read-only", playbook: "" });
    expect(body.limits).toEqual(legacy.limits);
  });

  it("will not save a number out of range", async () => {
    setup({ ...legacy, legacy: false, updatedBy: { id: "owner1", name: "Owner One" }, updatedAt: new Date().toISOString() });
    expect(await screen.findByText(/Changed by Owner One/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Investigations at once"), { target: { value: "0" } });
    expect(await screen.findByText("Investigations at once must be 1 to 20")).toBeInTheDocument();
    for (const button of screen.getAllByRole("button", { name: "Save" })) expect(button).toBeDisabled();
  });
});

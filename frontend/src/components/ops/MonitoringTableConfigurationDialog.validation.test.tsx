import { render, screen } from "@testing-library/react";
import { MonitoringTableConfigurationDialog } from "./MonitoringTableConfigurationDialog";

const base = {
  open: true,
  onOpenChange: vi.fn(),
  draft: { name: "Commercial checks", provider: "databricks", catalog: "example", schema: "quality", resultTable: "results", warehouseId: "warehouse", mapping: { checkId: "check_id", status: "status", executedAt: "executed_at" }, enabled: true },
  providers: [{ id: "databricks", name: "Databricks", source: "managed", profileId: "example" }],
  analysis: null,
  pending: false,
  analyzing: false,
  error: null,
  allowDataSample: false,
  onDraftChange: vi.fn(),
  onAllowDataSampleChange: vi.fn(),
  onAnalyze: vi.fn(),
  onMappingChange: vi.fn(),
  onSave: vi.fn(),
};

it("requires table DDL before analysis can be requested", () => {
  const { rerender } = render(<MonitoringTableConfigurationDialog {...base} />);
  expect(screen.getByRole("button", { name: "Analyze DDL" })).toBeDisabled();

  rerender(<MonitoringTableConfigurationDialog {...base} draft={{ ...base.draft, ddl: "CREATE TABLE results (check_id STRING, status STRING, executed_at TIMESTAMP)" }} />);
  expect(screen.getByRole("button", { name: "Analyze DDL" })).toBeEnabled();
});

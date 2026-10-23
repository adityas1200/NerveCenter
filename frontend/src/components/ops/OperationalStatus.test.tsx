import { render, screen } from "@testing-library/react";
import { OperationalStatus, statusMeta } from "./OperationalStatus";

describe("OperationalStatus", () => {
  it("renders open work as informational blue, not amber", () => {
    render(<OperationalStatus value="open" />);
    expect(screen.getByText("Open")).toHaveClass("border-blue-200", "bg-blue-50", "text-blue-700");
  });

  it.each([["in_progress", "In progress"], ["running", "In progress"], ["active", "Active"], ["ready", "Ready"], ["delayed", "Late"]])("renders %s as amber in-progress state %s", (value, label) => {
    render(<OperationalStatus value={value} />);
    expect(screen.getByText(label)).toHaveClass("border-amber-200", "bg-amber-50", "text-amber-800");
  });

  it("renders waiting as a violet human-review state", () => {
    render(<OperationalStatus value="waiting" />);
    expect(screen.getByText("Needs human review")).toHaveClass("border-violet-200", "bg-violet-50", "text-violet-700");
  });

  it("distinguishes waiting on an agent from waiting on a person", () => {
    expect(statusMeta("waiting", { waitingReason: "agent" })).toMatchObject({ label: "Waiting on agent", tone: "warning" });
    expect(statusMeta("waiting", { waitingReason: "human" })).toMatchObject({ label: "Needs human review", tone: "review" });
  });

  it.each([["successful", "Successful"], ["healthy", "Healthy"], ["resolved", "Resolved"], ["completed", "Completed"], ["RCA complete", "Root cause found"]])("reserves green for successful state %s", (value, label) => {
    render(<OperationalStatus value={value} />);
    expect(screen.getByText(label)).toHaveClass("border-emerald-200", "bg-emerald-50", "text-emerald-700");
  });

  it("names a missed schedule Overdue and a paused one Paused, and lets a screen override the word", () => {
    render(<><OperationalStatus value="overdue" /><OperationalStatus value="paused" /><OperationalStatus value="running" label="Running" /></>);
    expect(screen.getByText("Overdue")).toHaveClass("border-amber-200");
    expect(screen.getByText("Paused")).toHaveClass("border-slate-200");
    expect(screen.getByText("Running")).toHaveClass("border-amber-200");
  });

  it("renders an unclassified label as neutral rather than successful", () => {
    render(<OperationalStatus value="configuration review" />);
    expect(screen.getByText("Configuration review")).toHaveClass("border-slate-200", "bg-slate-50", "text-slate-600");
  });

  it("does not mistake unsuccessful for successful", () => {
    render(<OperationalStatus value="unsuccessful" />);
    expect(screen.getByText("Failed")).toHaveClass("border-rose-200", "bg-rose-50", "text-rose-700");
  });

  it("marks only moving work as live", () => {
    expect(statusMeta("running").live).toBe(true);
    expect(statusMeta("open").live).toBe(false);
    expect(statusMeta("failed").live).toBe(false);
  });
});

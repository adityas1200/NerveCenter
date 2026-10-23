import { formatAbsoluteTime } from "@/components/ui";
import { connectionLabel, plainCheckDetail, scheduleWords } from "./routineText";

describe("routineText", () => {
  it("keeps the backend's sentence and only translates cron the backend left raw", () => {
    expect(scheduleWords({ trigger: { type: "schedule", expression: "0 9 * * 1-5", timezone: "Asia/Kolkata" }, scheduleText: "Every weekday at 9:00 AM (Asia/Kolkata)" })).toBe("Every weekday at 9:00 AM (Asia/Kolkata)");
    expect(scheduleWords({ trigger: { type: "schedule", expression: "15 8,17 * * 1-5", timezone: "UTC" }, scheduleText: "15 8,17 * * 1-5" })).toBe("At 08:15 and 17:15, Monday through Friday (UTC)");
    expect(scheduleWords({ trigger: { type: "manual" }, scheduleText: "Manual" })).toBe("Manual");
  });

  it("names connections the way the Connectors page does, falling back to words", () => {
    expect(connectionLabel("atlassian", { atlassian: "Atlassian" })).toBe("Atlassian");
    expect(connectionLabel("runbook-search", {})).toBe("Runbook search");
  });

  it("formats ISO timestamps inside setup-check lines", () => {
    const text = plainCheckDetail("Every weekday at 9:00 AM · next 2026-09-28T03:30:00.000Z");
    expect(text).not.toMatch(/T03:30:00/);
    expect(text).toContain(formatAbsoluteTime("2026-09-28T03:30:00.000Z"));
  });
});

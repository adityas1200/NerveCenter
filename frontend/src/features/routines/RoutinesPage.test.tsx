import { fireEvent, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Routine } from "@/api/routines";
import { ToastProvider } from "@/components/ui";
import { RoutinesPage } from "./RoutinesPage";
import { jsonResponse, mockFetch, renderWithClient } from "@/test/utils";

const base: Routine = { name: "daily-ticket-review", title: "Daily ticket review", objective: "Review tickets.", trigger: { type: "schedule", timezone: "Asia/Kolkata", expression: "0 9 * * 1-5" }, uses: [], authority: {}, success: [], permission: "read-only", enabled: true, notify: "on_complete", connections: ["atlassian"], file: "daily-ticket-review.yaml", scheduleText: "Every weekday at 9:00 AM (Asia/Kolkata)", nextRunAt: new Date(Date.now() + 3_600_000).toISOString(), scheduleError: null, lastFiredAt: null, status: "scheduled", lastRun: { taskId: "T-1", status: "waiting", summary: "", createdAt: "2026-09-24T03:30:00Z", finishedAt: null, test: false, costUsd: 0 }, lastTest: null, recentRuns: [] };
const rawCron: Routine = { ...base, name: "twice-daily", title: "Twice daily sweep", trigger: { type: "schedule", timezone: "UTC", expression: "15 8,17 * * 1-5" }, scheduleText: "15 8,17 * * 1-5", lastRun: { taskId: "T-2", status: "done", summary: "All clear", createdAt: "2026-09-24T08:15:00Z", finishedAt: null, test: false, costUsd: 0 } };

describe("RoutinesPage", () => {
  it("opens a routine from anywhere on its row, reads cron as words and uses the task status words", async () => {
    mockFetch((url) => url.includes("/api/routines") ? jsonResponse({ items: [base, rawCron] }) : jsonResponse({ items: [] }));
    renderWithClient(<MemoryRouter initialEntries={["/routines"]}><ToastProvider><Routes><Route path="/routines" element={<RoutinesPage />} /><Route path="/routines/:name" element={<p>Routine page</p>} /></Routes></ToastProvider></MemoryRouter>);
    expect(await screen.findByText("Daily ticket review")).toBeInTheDocument();
    expect(screen.getByText("Every weekday at 9:00 AM (Asia/Kolkata)")).toBeInTheDocument();
    expect(screen.getByText("At 08:15 and 17:15, Monday through Friday (UTC)")).toBeInTheDocument();
    expect(screen.getByText("Waiting on you")).toBeInTheDocument();
    expect(screen.getByText("Done · All clear")).toBeInTheDocument();
    expect(screen.queryByText(/Finished/)).not.toBeInTheDocument();
    // The row itself is the link: clicking the schedule text opens the routine.
    fireEvent.click(screen.getByText("Every weekday at 9:00 AM (Asia/Kolkata)"));
    expect(await screen.findByText("Routine page")).toBeInTheDocument();
  });
});

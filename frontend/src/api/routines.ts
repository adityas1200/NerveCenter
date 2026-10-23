import { apiClient } from "@/api/client";
import type { Task, TaskPermission } from "@/api/tasks";
import type { UserIdentity } from "@/api/types";

/** Routines: repeated work the agent runs on a schedule. Each run is a Task. */

export type RoutineNotify = "on_complete" | "on_failure" | "never";
export type ScheduleKind = "weekday" | "daily" | "weekly" | "monthly" | "hours" | "manual" | "custom";

export interface RoutineRun { taskId: string; status: Task["status"]; summary: string; createdAt: string; finishedAt?: string | null; test: boolean; costUsd: number }

export interface Routine {
  name: string;
  title: string;
  objective: string;
  trigger: { type: "schedule" | "manual"; timezone?: string; expression?: string };
  uses: string[];
  authority: Record<string, string>;
  success: string[];
  permission: TaskPermission;
  enabled: boolean;
  notify: RoutineNotify;
  connections: string[];
  createdBy?: UserIdentity | null;
  file: string;
  scheduleText: string;
  nextRunAt: string | null;
  scheduleError: string | null;
  lastFiredAt: string | null;
  status: "running" | "paused" | "error" | "scheduled";
  lastRun: RoutineRun | null;
  lastTest: RoutineRun | null;
  recentRuns: RoutineRun[];
}

export interface RoutineSchedule { kind?: Exclude<ScheduleKind, "manual" | "custom">; cron?: string; time?: string; timezone?: string; weekday?: number; dayOfMonth?: number; everyHours?: number }

export interface RoutineInput { name?: string; title: string; objective: string; schedule: RoutineSchedule | null; permission: TaskPermission; notify: RoutineNotify; connections: string[]; enabled?: boolean }

export interface RoutineCheck { name: string; ok: boolean; checkedAt: string; checks: Array<{ id: string; ok: boolean; title: string; detail: string }> }

const routinePath = (name: string) => `/api/routines/${encodeURIComponent(name)}`;

export const routinesApi = {
  list: (signal?: AbortSignal) => apiClient.get<{ items: Routine[] }>("/api/routines", { signal }),
  get: (name: string, signal?: AbortSignal) => apiClient.get<Routine>(routinePath(name), { signal }),
  create: (input: RoutineInput) => apiClient.post<Routine>("/api/routines", input),
  update: (name: string, input: RoutineInput) => apiClient.put<Routine>(routinePath(name), input),
  remove: (name: string) => apiClient.delete<{ deleted: boolean }>(routinePath(name)),
  run: (name: string) => apiClient.post<Task>(`${routinePath(name)}/run`),
  test: (name: string) => apiClient.post<Task>(`${routinePath(name)}/test`),
  pause: (name: string) => apiClient.post<Routine>(`${routinePath(name)}/pause`),
  resume: (name: string) => apiClient.post<Routine>(`${routinePath(name)}/resume`),
  check: (name: string) => apiClient.post<RoutineCheck>(`${routinePath(name)}/check`),
};

export const routineKeys = {
  all: ["routines"] as const,
  detail: (name: string) => ["routines", name] as const,
};

export const TIMEZONES = ["Asia/Kolkata", "UTC", "Europe/London", "Europe/Berlin", "Europe/Zurich", "America/New_York", "America/Chicago", "America/Los_Angeles", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney"];
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

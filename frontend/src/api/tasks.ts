import { apiBaseUrl, apiClient, streamSse } from "@/api/client";
import type { QuestionAnswers, QuestionSpec } from "@/api/inbox";
import { getCurrentProject } from "@/api/projects";
import type { FileContent, TreeNode } from "@/api/library";
import type { UserIdentity } from "@/api/types";
import type { AgentSelection } from "@/components/ops/agentPanelContext";

/** Tasks: one agent session each. Ticket tasks, routine runs, automatic investigations and ad-hoc work share this shape. */

export type TaskType = "ticket" | "routine" | "adhoc" | "alert";
export type TaskStatus = "queued" | "running" | "waiting" | "done" | "failed" | "cancelled";
export type TaskPermission = "read-only" | "policy" | "ask" | "allow";

export interface TaskCost { totalUsd: number; inputTokens: number; outputTokens: number; turns: number; durationMs: number; runs: number }

export interface PageContext { name: string; path: string; filters?: Record<string, string>; selection?: AgentSelection | null; visible?: string[]; open?: { kind: string; id: string; title?: string }; summary?: string; /** Records the person pointed at with @ in this message. */ mentions?: Array<{ kind: string; id: string; title?: string }> }

export interface TaskContext {
  ticket?: { ticketId: string; title?: string; priority?: string; status?: string; source?: string; externalReference?: { number?: string; url?: string } | null; [key: string]: unknown };
  routine?: { name: string; title?: string; objective?: string; [key: string]: unknown };
  /** The alert an automatic investigation is for (SPEC-automations-01 FR-17). */
  alert?: { alertId: string; trigger: string; subject?: { type?: string; id?: string; name?: string }; [key: string]: unknown };
  page?: PageContext;
  /** A knowledge setup task and the base it fills (SPEC-knowledge-03 FR-2). */
  knowledgeSetup?: boolean;
  knowledgeBase?: string;
}

/** One question in a knowledge setup task's interview guide (SPEC-knowledge-03 FR-6). */
export type GuideStatus = "open" | "answered" | "partly" | "not_discussed" | "dropped";
export interface GuideQuestion {
  id: string; theme: string; question: string; why: string; evidence: Array<{ label: string; href?: string }>; audience: string;
  priority: "high" | "medium" | "low"; status: GuideStatus; answer: string; cites: Array<{ file: string; at?: string; speaker?: string }>;
  pages: string[]; round: number; updatedAt: string | null;
}
export interface InterviewGuide { questions: GuideQuestion[]; updatedAt: string | null }

export interface Task {
  id: string;
  type: TaskType;
  title: string;
  summary: string;
  status: TaskStatus;
  permission: TaskPermission;
  context: TaskContext;
  createdBy: UserIdentity;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  sessionId?: string | null;
  cost: TaskCost;
  pendingApprovalId?: string | null;
  /** Changes the agent made (reads excluded). */
  changes?: number;
  error?: string | null;
  /** Messages typed while the agent works; they run one by one when the current step ends. */
  queue?: QueuedMessage[];
  /** Goes up each time a sent message is edited and the conversation rewound; readers reload the events when it changes. */
  historyVersion?: number;
  /** Hidden from the default Tasks list without deleting anything; recoverable from the Archived view. */
  archived?: boolean;
}

export interface QueuedMessage { id: string; text: string; actor: UserIdentity; queuedAt: string; attachments?: TaskAttachment[] }

/** A file attached to a message (SPEC-tasks-11). `path` is in the task folder, for `fileUrl` and the file viewer. */
export interface TaskAttachment { name: string; path: string; size: number; mime: string }
/** A file on its way up: `data` is base64. */
export interface AttachmentUpload { name: string; data: string }

export type TaskEventType = "user.message" | "session.init" | "assistant.text" | "tool.use" | "tool.result" | "approval.requested" | "approval.decided" | "approval.denied" | "question.asked" | "question.answered" | "result" | "error" | "status";

/** What an `apply_fix` approval would run, as NerveCenter stored it (SPEC-tasks-13 FR-11). */
export interface FixSummary { proposalId: string; title: string; target: string; sandbox: string; testsPassed: number; testsTotal: number; statement: string }

export interface TaskEvent {
  id: string;
  taskId: string;
  seq: number;
  at: string;
  type: TaskEventType;
  text?: string;
  title?: string;
  detail?: string | null;
  actor?: UserIdentity;
  // user.message: files the person attached
  attachments?: TaskAttachment[];
  // session.init
  model?: string;
  tools?: number;
  skills?: string[];
  // The project's own and granted skills the session loaded (SPEC-tasks-08 FR-1).
  projectSkills?: string[];
  mcpServers?: Array<{ name: string; status: string }>;
  plugins?: string[];
  // tool.use / tool.result
  toolUseId?: string;
  name?: string;
  input?: string;
  content?: string;
  isError?: boolean;
  parentToolUseId?: string | null;
  // approvals
  inboxId?: string;
  category?: string;
  decision?: "approved" | "denied";
  tool?: { name: string; input: string };
  /** The agent's own one-sentence reason for the change it asked to make. */
  reason?: string | null;
  /** approval.requested for `apply_fix`: the tested proposal the approval runs (SPEC-tasks-13 FR-11). */
  fix?: FixSummary;
  // question.asked / question.answered (inboxId names the Inbox item)
  questions?: QuestionSpec[];
  answers?: QuestionAnswers;
  /** The question is a `request_input` form: `title` names it and `reason` says why Sonic needs it. */
  form?: boolean;
  // result
  subtype?: string;
  costUsd?: number;
  usage?: { input_tokens?: number; output_tokens?: number } | null;
  turns?: number;
  durationMs?: number;
  // status
  status?: string;
}

export interface TaskWithEvents extends Task { events: TaskEvent[] }

/**
 * Partial output, live only and never stored: the reply as it is written and the name of a tool the
 * moment the agent decides to call it. The stored `assistant.text` / `tool.use` events follow.
 */
export type TaskDelta =
  | { taskId: string; at: string; parentToolUseId: string | null; kind: "text"; phase: "start"; index: number }
  | { taskId: string; at: string; parentToolUseId: string | null; kind: "text"; phase: "delta"; index: number; text: string }
  | { taskId: string; at: string; parentToolUseId: string | null; kind: "block"; phase: "stop"; index: number }
  | { taskId: string; at: string; parentToolUseId: string | null; kind: "tool"; phase: "start"; index: number; name: string; title: string };

export interface CreateTaskRequest { type?: TaskType; title?: string; prompt: string; context?: TaskContext; permission?: TaskPermission; notify?: boolean; attachments?: AttachmentUpload[] }

const taskPath = (id: string) => `/api/tasks/${encodeURIComponent(id)}`;

export const tasksApi = {
  list: (params: { type?: string; status?: string; archived?: "true" | "all"; q?: string; limit?: number; offset?: number } = {}, signal?: AbortSignal) => {
    const search = new URLSearchParams();
    if (params.type && params.type !== "all") search.set("type", params.type);
    if (params.status && params.status !== "all") search.set("status", params.status);
    if (params.archived) search.set("archived", params.archived);
    if (params.q) search.set("q", params.q);
    if (params.limit !== undefined) search.set("limit", String(params.limit));
    if (params.offset !== undefined) search.set("offset", String(params.offset));
    const query = search.toString();
    return apiClient.get<{ items: Task[]; total: number; active: number; waiting: number }>(`/api/tasks${query ? `?${query}` : ""}`, { signal });
  },
  create: (input: CreateTaskRequest) => apiClient.post<Task>("/api/tasks", input),
  get: (id: string, signal?: AbortSignal) => apiClient.get<TaskWithEvents>(taskPath(id), { signal }),
  logs: (id: string, signal?: AbortSignal) => apiClient.get<{ id: string; sessionId: string | null; cost: TaskCost; events: TaskEvent[] }>(`${taskPath(id)}/logs`, { signal }),
  /** A follow-up. `context` refreshes what the person is looking at; `permission` changes what the agent may do from now on. */
  send: (id: string, text: string, context?: TaskContext, permission?: TaskPermission, attachments?: AttachmentUpload[]) => apiClient.post<{ queued: boolean; message?: QueuedMessage; task: Task }>(`${taskPath(id)}/messages`, { text, ...(context ? { context } : {}), ...(permission ? { permission } : {}), ...(attachments?.length ? { attachments } : {}) }),
  /** Change a message already sent: the task is rewound to it and the agent answers the new text. */
  editMessage: (id: string, eventId: string, text: string) => apiClient.patch<Task>(`${taskPath(id)}/messages/${encodeURIComponent(eventId)}`, { text }),
  /** The queue: change a waiting message, drop it, or send it now (which interrupts the current step). */
  editQueued: (id: string, messageId: string, text: string) => apiClient.patch<{ message: QueuedMessage; task: Task }>(`${taskPath(id)}/queue/${encodeURIComponent(messageId)}`, { text }),
  removeQueued: (id: string, messageId: string) => apiClient.delete<{ removed: boolean; task: Task }>(`${taskPath(id)}/queue/${encodeURIComponent(messageId)}`),
  sendQueuedNow: (id: string, messageId: string) => apiClient.post<{ interrupted: boolean; task: Task }>(`${taskPath(id)}/queue/${encodeURIComponent(messageId)}/send`),
  remove: (id: string) => apiClient.delete<{ id: string; deleted: boolean }>(`/api/tasks/${encodeURIComponent(id)}`),
  cancel: (id: string) => apiClient.post<Task>(`${taskPath(id)}/cancel`),
  setPermission: (id: string, permission: TaskPermission) => apiClient.patch<Task>(taskPath(id), { permission }),
  /** Hides (or restores) a task from the default Tasks list; nothing is deleted. */
  setArchived: (id: string, archived: boolean) => apiClient.patch<Task>(taskPath(id), { archived }),
  /** Files under the task folder: a tree, text content for the viewer, and a raw URL for images, PDFs and downloads. */
  files: (id: string, signal?: AbortSignal) => apiClient.get<{ id: string; items: TreeNode[] }>(`${taskPath(id)}/files`, { signal }),
  interviewGuide: (id: string, signal?: AbortSignal) => apiClient.get<InterviewGuide>(`${taskPath(id)}/interview-guide`, { signal }),
  fileContent: (id: string, path: string, signal?: AbortSignal) => apiClient.get<FileContent>(`${taskPath(id)}/files/content?path=${encodeURIComponent(path)}`, { signal }),
  /** The browser opens this itself (links, iframes, images) and cannot send the project header, so the URL names it (SPEC-projects-01 FR-50). */
  fileUrl: (id: string, path: string) => {
    const project = getCurrentProject();
    return `${apiBaseUrl}${taskPath(id)}/files/raw?path=${encodeURIComponent(path)}${project ? `&project=${encodeURIComponent(project)}` : ""}`;
  },
  /** Live stream. Emits stored events after `afterSeq`, then live ones, plus task snapshots and (optionally) partial-output deltas. */
  stream: (id: string, afterSeq: number, handlers: { onEvent: (event: TaskEvent) => void; onTask: (task: Task) => void; onDelta?: (delta: TaskDelta) => void }, signal?: AbortSignal) =>
    streamSse<TaskEvent | Task | TaskDelta>(`${taskPath(id)}/events?after=${afterSeq}`, {
      signal,
      onMessage: (message) => {
        if (message.event === "task") handlers.onTask(message.data as Task);
        else if (message.event === "delta") handlers.onDelta?.(message.data as TaskDelta);
        else handlers.onEvent(message.data as TaskEvent);
      },
    }),
};

export const TASK_TYPE_LABEL: Record<TaskType, string> = { ticket: "Ticket", routine: "Routine", adhoc: "Chat", alert: "Alert" };
const ALERT_WORDS: Record<string, string> = { pipelineFailed: "pipeline failed", pipelineLate: "pipeline late", dqFailed: "check failed" };

export function taskTypeDetail(task: Task): string {
  if (task.type === "ticket") return task.context.ticket?.externalReference?.number || task.context.ticket?.ticketId || "";
  if (task.type === "routine") return task.context.routine?.name || "";
  if (task.type === "alert") return task.context.alert?.subject?.name || "";
  return task.context.page?.name || "";
}

export interface StartedBy { kind: "person" | "ticket" | "routine" | "system"; label: string }

/**
 * Who or what started a task, in one line: "Routine · Daily ticket review", "Automatic triage · INC0012345",
 * "Mitesh Shinde · from ticket INC0012345", "Mitesh Shinde · Pipelines", or "NerveCenter".
 */
export function startedBy(task: Pick<Task, "type" | "context" | "createdBy" | "title">): StartedBy {
  const bySystem = !task.createdBy || task.createdBy.id === "system";
  const person = task.createdBy?.name || task.createdBy?.id || "";
  if (task.type === "routine") return { kind: "routine", label: `Routine · ${task.context.routine?.title || task.context.routine?.name || task.title}` };
  // An automatic investigation on a ticket is still started by the automation, not by the ticket poller.
  if (task.type === "alert" || task.context.alert) return { kind: "system", label: `Automation · ${ALERT_WORDS[String(task.context.alert?.trigger)] || "alert"}` };
  if (task.type === "ticket") {
    const number = task.context.ticket?.externalReference?.number || task.context.ticket?.ticketId || "";
    if (bySystem) return { kind: "ticket", label: number ? `Automatic triage · ${number}` : "Automatic triage" };
    return { kind: "person", label: number ? `${person} · from ticket ${number}` : person };
  }
  if (!bySystem) return { kind: "person", label: task.context.page?.name ? `${person} · ${task.context.page.name}` : person };
  return { kind: "system", label: "NerveCenter" };
}

/** The one set of words for what a task may do, everywhere it is shown or picked. */
export const PERMISSION_LABEL: Record<TaskPermission, string> = { "read-only": "Look only", ask: "Ask first", policy: "Follow policy", allow: "Never ask" };
export const PERMISSION_HELP: Record<TaskPermission, string> = {
  "read-only": "Reads and reports. Changes nothing.",
  ask: "Every change waits for your approval.",
  policy: "Everyday changes run. Email, access, production and ticket closure follow the policy in Settings.",
  allow: "Every change runs without asking. Each one is still recorded.",
};

/** Why a change needed a person: the policy category the backend put it in. */
export const CATEGORY_LABEL: Record<string, string> = { email_send: "Send email", privileged_access: "Access change", production_changes: "Production change", ticket_writes: "Ticket change", workspace_changes: "Workspace config", knowledge_drafts: "Knowledge draft", default_write: "Change" };

/** The one set of status words for a task, used by the list, the detail header and the result pane. */
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = { queued: "Queued", running: "Running", waiting: "Waiting on you", done: "Done", failed: "Failed", cancelled: "Stopped" };

export const taskKeys = {
  all: ["tasks"] as const,
  list: (filters?: object) => ["tasks", "list", filters ?? {}] as const,
  detail: (id: string) => ["tasks", "detail", id] as const,
  logs: (id: string) => ["tasks", "detail", id, "logs"] as const,
};

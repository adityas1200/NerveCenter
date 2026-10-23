import { apiClient } from "@/api/client";
import type { FixSummary } from "@/api/tasks";
import type { UserIdentity } from "@/api/types";

/** Inbox: approvals the agent is waiting on, questions it asked, and notifications from tasks. */

export type InboxKind = "approval" | "question" | "notification";
export type InboxStatus = "pending" | "approved" | "denied" | "answered" | "read" | "cancelled";

/** One question the agent asked with the SDK's question tool: 2-4 options, one or many to pick, plus a typed answer. */
export interface QuestionOption { label: string; description?: string }
export type FieldType = "text" | "textarea" | "number" | "date" | "email" | "select" | "multiselect" | "boolean";
/** A `request_input` form field (SPEC-tasks-10 FR-20); a plain question has none. */
export interface QuestionField { type: FieldType; required?: boolean; placeholder?: string | null }
export interface QuestionSpec { question: string; header?: string; multiSelect?: boolean; options: QuestionOption[]; field?: QuestionField }
/** Question text → the chosen label(s) ("Veltrix, Corvana") or the typed free answer. */
export type QuestionAnswers = Record<string, string>;

export interface InboxItem {
  id: string;
  kind: InboxKind;
  status: InboxStatus;
  taskId: string;
  title: string;
  detail?: string | null;
  tone?: "bad" | "warning" | "success" | "neutral";
  tool?: { name: string; input: string };
  /** Policy category of an approval (email_send, production_changes...) and its label. */
  category?: string;
  categoryLabel?: string;
  createdAt: string;
  updatedAt: string;
  decidedAt?: string | null;
  decidedBy?: UserIdentity | null;
  readBy?: UserIdentity | null;
  /** The agent's own one-sentence reason for the change it asked to make. */
  reason?: string | null;
  /** A structured question (from the agent's question tool). Legacy questions, a reply that ended in "?", have none. */
  questions?: QuestionSpec[];
  answers?: QuestionAnswers;
  /** An `apply_fix` approval: the tested proposal it runs (SPEC-tasks-13 FR-11). */
  fix?: FixSummary;
}

/** Decided approvals by policy category in a window: the evidence behind widening what Sonic may do without asking. */
export interface ApprovalStats {
  days: number;
  since: string;
  totals: { approved: number; denied: number; pending: number };
  categories: Array<{ category: string; label: string; approved: number; denied: number; pending: number; cancelled: number; lastDecidedAt: string | null }>;
}

export const inboxApi = {
  list: (params: { view?: "all" | "needs_action" | "done"; status?: string; kind?: string; taskId?: string; limit?: number; offset?: number } = {}, signal?: AbortSignal) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "all") search.set(key, String(value));
    const query = search.toString();
    return apiClient.get<{ items: InboxItem[]; total: number; pending: number; approvals: number; unread: number }>(`/api/inbox${query ? `?${query}` : ""}`, { signal });
  },
  approve: (id: string) => apiClient.post<InboxItem>(`/api/inbox/${encodeURIComponent(id)}/approve`),
  deny: (id: string) => apiClient.post<InboxItem>(`/api/inbox/${encodeURIComponent(id)}/deny`),
  /** Answer the agent's question. The task resumes with the answers in the tool call. */
  answer: (id: string, answers: QuestionAnswers) => apiClient.post<InboxItem>(`/api/inbox/${encodeURIComponent(id)}/answer`, { answers }),
  read: (id: string) => apiClient.post<InboxItem>(`/api/inbox/${encodeURIComponent(id)}/read`),
  readAll: () => apiClient.post<{ updated: number }>("/api/inbox/read-all"),
  stats: (days = 30, signal?: AbortSignal) => apiClient.get<ApprovalStats>(`/api/inbox/stats?days=${days}`, { signal }),
};

export const inboxKeys = {
  all: ["inbox"] as const,
  list: (filters?: object) => ["inbox", "list", filters ?? {}] as const,
  stats: (days: number) => ["inbox", "stats", days] as const,
};


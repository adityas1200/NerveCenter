import { apiClient } from "@/api/client";

/**
 * Skills and Knowledge: read-only browsers over the plugin's skills, custom skills uploaded
 * into the workspace, and the knowledge bases the agent reads. Admins upload and sync.
 */

export interface TreeNode { name: string; path: string; type: "file" | "directory"; size?: number; children?: TreeNode[] }
export interface FileContent { path: string; size: number; content: string }

/** `heading` is the first heading of SKILL.md, a plain-words title such as "Investigate root cause". */
export interface Skill { id: string; name: string; description: string; origin: "plugin" | "custom"; heading?: string }
export interface SkillUploadResult extends Skill { files: number; replaced: boolean }

export interface KnowledgeBase {
  name: string;
  title: string;
  description: string;
  hasIndex: boolean;
  kind: "git" | "local" | string;
  url: string | null;
  branch: string | null;
  /** Folders of the repository that are checked out; empty means the whole repository. */
  folders?: string[];
  hasToken: boolean;
  addedBy: string | null;
  addedAt: string | null;
  lastSyncAt: string | null;
  lastCommit: string | null;
  lastError: string | null;
  files: number;
  /** Git bases: kept drafts become a pull request (`pull_request`, the default) or go straight to the branch (`direct`). */
  review?: "pull_request" | "direct";
  /** The latest pull requests NerveCenter opened on the base, newest first. */
  proposals?: KnowledgeProposal[];
  /** Uncommitted files in a Git base: drafts the agent proposed. Sync waits until they are committed or removed. */
  pendingChanges?: number;
  /** A base built from uploads: the documents it was built from, and the latest task that read them. */
  documents?: string[];
  lastTaskId?: string | null;
  lastUploadAt?: string | null;
}
/** One document for an upload, its bytes as base64. */
export interface UploadDocument { name: string; data: string }
/** An upload's answer: the base, the files received in this upload, and the task reading them. */
export interface KnowledgeUploadResult extends KnowledgeBase { received: string[]; taskId: string | null }
/** Mirrors the backend limits in knowledge-service.mjs. */
export const UPLOAD_LIMITS = { files: 50, bytes: 25 * 1024 * 1024, accept: ".docx,.pptx,.xlsx,.xlsm,.pdf,.html,.htm,.md,.markdown,.txt,.rst,.csv,.tsv,.json,.yaml,.yml,.sql,.xml" };
/** A lesson the agent saved after verified work, waiting in the base for a person to keep or discard. */
export interface KnowledgeDraft {
  base: string;
  path: string;
  change: "added" | "modified" | "deleted";
  title: string;
  section: string | null;
  sourceTicket: string | null;
  /** Why the agent put it here, in its own words. */
  reason: string | null;
  taskId: string | null;
  /** "agent" when the agent saved it; "unknown" for any other uncommitted file in the base. */
  by: "agent" | "unknown";
  at: string | null;
  /** Unified diff against the last kept version; every line is "+" for a new page. */
  diff: string;
  /** Where it came from (SPEC-knowledge-05): a lesson after verified work, a person's correction, an interview, a document, the weekly pass or an eval case. Null for drafts saved before origins. */
  origin?: KnowledgeOrigin | null;
  /** With a correction or interview: who said it. */
  taughtBy?: string | null;
}
export type KnowledgeOrigin = "lesson" | "correction" | "interview" | "document" | "pass" | "eval";

/** One page of a base on the knowledge map (SPEC-knowledge-04 FR-10). `page` on a link is the resolved page, or null for plain text. */
export interface KnowledgeMapLink { field: string; target: string; page: string | null }
export interface KnowledgeMapNode { path: string; title: string; type: string | null; shelf: string; status: "draft" | "kept"; stale: boolean; staleAfter: string | null; owner: string | null; description: string | null; fields: Record<string, string>; links: KnowledgeMapLink[] }
export interface KnowledgeShelf { name: string; pages: number; drafts: number; stale: number }
export interface KnowledgeMap { base: string; title: string; pages: KnowledgeMapNode[]; shelves: KnowledgeShelf[]; totals: { pages: number; kept: number; drafts: number; stale: number; links: number; orphans: number }; truncated: boolean }

/** A journey's eval score over time (SPEC-knowledge-06 FR-5). */
export interface EvalCaseResult { path: string; result: "pass" | "partial" | "fail"; note?: string; missing?: string[] }
export interface Journey {
  journey: string;
  cases: number;
  latest: { score: number; passed: number; partial: number; failed: number; total: number; at: string; taskId: string | null } | null;
  previous: number | null;
  trend: number[];
  failing: EvalCaseResult[];
}

/** The weekly knowledge pass and its latest digest (SPEC-knowledge-07). */
export interface KnowledgeDigest {
  at: string;
  taskId: string | null;
  drafts: { waiting: number; fromCorrections: number; fromLessons: number; merged: number };
  stale: Array<{ path: string; staleAfter: string | null }>;
  drift: Array<{ path: string; field: string; page: string; live: string }>;
  changedDocs: Array<{ path: string; source: string }>;
  gaps: Array<{ text: string; journey?: string; tasks: string[] }>;
  evals: Array<{ journey: string; score: number; previous?: number }>;
  weakest: string | null;
  summary: string;
}
export interface KnowledgePass {
  enabled: boolean;
  weekday: number;
  time: string;
  timezone: string | null;
  routine: { name: string; nextRunAt: string | null; lastRun: { taskId?: string; status?: string } | null; status?: string } | null;
  digest: KnowledgeDigest | null;
}
export interface KnowledgeProposal { branch: string; base: string; title: string; at: string; by: string | null; pages: string[]; url: string | null; number: number | null }
/** `review: "pull_request"`: the kept drafts went to a branch and a pull request the base's reviewers merge. */
export interface KeepDraftsResult { base: string; kept: string[]; pushed?: boolean; pushError?: string; review?: "pull_request"; branch?: string; pullRequest?: { url: string; number: number | null } | null; pullRequestError?: string }
export interface KnowledgeSetup { taskId: string | null; base: string | null }
export interface KnowledgeSetupStarted { taskId: string; base: string; created: boolean }
export interface KnowledgeMcp { mode: string; connection: string; collections: string[] }
export interface KnowledgeList { items: KnowledgeBase[]; mcp: KnowledgeMcp }
export interface KnowledgeInput { title: string; url: string; branch?: string; token?: string; username?: string; folders?: string[] }
export interface RepositoryAccess { url: string; branch?: string; token?: string; username?: string }
export interface RepositoryFolder { name: string; path: string; files: number; markdown: number; children: RepositoryFolder[] }
/** What `inspect` found in a repository before anything is cloned into the workspace. */
export interface RepositoryInspection { url: string; branch: string | null; commit: string | null; suggestedTitle: string; folders: RepositoryFolder[]; rootFiles: string[]; files: number; markdown: number }

export const skillKeys = { all: ["skills"] as const, tree: (id: string) => ["skills", id, "tree"] as const, file: (id: string, path: string) => ["skills", id, "file", path] as const };
export const knowledgeKeys = { all: ["knowledge"] as const, setup: ["knowledge", "setup"] as const, tree: (name: string) => ["knowledge", name, "tree"] as const, file: (name: string, path: string) => ["knowledge", name, "file", path] as const, drafts: (name: string) => ["knowledge", name, "drafts"] as const, map: (name: string) => ["knowledge", name, "map"] as const, journeys: ["knowledge", "journeys"] as const, pass: ["knowledge", "pass"] as const };

const skillPath = (id: string) => `/api/skills/${encodeURIComponent(id)}`;
const basePath = (name: string) => `/api/knowledge/${encodeURIComponent(name)}`;

export const skillsApi = {
  list: (signal?: AbortSignal) => apiClient.get<{ items: Skill[] }>("/api/skills", { signal }),
  tree: (id: string, signal?: AbortSignal) => apiClient.get<{ id: string; items: TreeNode[] }>(`${skillPath(id)}/tree`, { signal }),
  file: (id: string, path: string, signal?: AbortSignal) => apiClient.get<FileContent>(`${skillPath(id)}/file?path=${encodeURIComponent(path)}`, { signal }),
  upload: (zipBase64: string, name?: string) => apiClient.post<SkillUploadResult>("/api/skills/upload", { zipBase64, name }),
  remove: (id: string) => apiClient.delete<{ id: string; deleted: boolean }>(skillPath(id)),
};

export const knowledgeApi = {
  list: (signal?: AbortSignal) => apiClient.get<KnowledgeList>("/api/knowledge", { signal }),
  add: (input: KnowledgeInput) => apiClient.post<KnowledgeBase>("/api/knowledge", input),
  inspect: (input: RepositoryAccess) => apiClient.post<RepositoryInspection>("/api/knowledge/inspect", input),
  /** The project's knowledge setup task, if one is open (SPEC-knowledge-03 FR-3). */
  setupTask: (signal?: AbortSignal) => apiClient.get<KnowledgeSetup>("/api/knowledge/setup", { signal }),
  /** Open the knowledge setup: the task that is open, or a new one filling `base` (team-knowledge when left out). */
  setup: (base?: string) => apiClient.post<KnowledgeSetupStarted>("/api/knowledge/setup", base ? { base } : {}),
  /** A new base built from documents; a task drafts pages from them for review. */
  upload: (input: { title: string; files: UploadDocument[] }) => apiClient.post<KnowledgeUploadResult>("/api/knowledge/upload", input),
  addDocuments: (name: string, files: UploadDocument[]) => apiClient.post<KnowledgeUploadResult>(`${basePath(name)}/documents`, { files }),
  sync: (name: string) => apiClient.post<KnowledgeBase>(`${basePath(name)}/sync`),
  remove: (name: string) => apiClient.delete<{ name: string; deleted: boolean }>(basePath(name)),
  tree: (name: string, signal?: AbortSignal) => apiClient.get<{ name: string; items: TreeNode[] }>(`${basePath(name)}/tree`, { signal }),
  file: (name: string, path: string, signal?: AbortSignal) => apiClient.get<FileContent>(`${basePath(name)}/file?path=${encodeURIComponent(path)}`, { signal }),
  drafts: (name: string, signal?: AbortSignal) => apiClient.get<{ name: string; items: KnowledgeDraft[] }>(`${basePath(name)}/drafts`, { signal }),
  /** Keep one draft (`path`) or every draft in the base (`null`). */
  keepDraft: (name: string, path: string | null) => apiClient.post<KeepDraftsResult>(`${basePath(name)}/drafts/keep`, path ? { path } : { all: true }),
  discardDraft: (name: string, path: string | null) => apiClient.post<{ base: string; discarded: string[] }>(`${basePath(name)}/drafts/discard`, path ? { path } : { all: true }),
  /** One base as pages and typed links. */
  map: (name: string, signal?: AbortSignal) => apiClient.get<KnowledgeMap>(`${basePath(name)}/map`, { signal }),
  /** Eval scores per journey, weakest first. */
  journeys: (signal?: AbortSignal) => apiClient.get<{ journeys: Journey[] }>("/api/knowledge/journeys", { signal }),
  pass: (signal?: AbortSignal) => apiClient.get<KnowledgePass>("/api/knowledge/pass", { signal }),
  /** Turn the weekly pass on (optionally on another day or time) or off. Owners only. */
  setPass: (input: { enabled: boolean; weekday?: number; time?: string }) => apiClient.put<KnowledgePass>("/api/knowledge/pass", input),
};

/** Read a File as base64 for the upload endpoint. */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("Could not read the file"));
    reader.onload = () => resolve(String(reader.result || "").replace(/^data:[^;]*;base64,/, ""));
    reader.readAsDataURL(file);
  });
}

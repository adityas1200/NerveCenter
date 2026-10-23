import type { KnowledgeBase } from "@/api/library";
import { formatRelativeTime } from "@/components/ui";

/** Turns a raw git or clone error into one sentence a business user can act on. */
export function plainSyncError(error?: string | null): string {
  const text = String(error || "").trim();
  if (!text) return "";
  if (/uncommitted|draft|pending change/i.test(text)) return "Sync is waiting until the agent's drafts are reviewed.";
  if (/403|401|invalid access token|unauthori[sz]ed|authentication failed|could not read username|invalid username or (token|password)/i.test(text)) return "The repository rejected the access token.";
  if (/404|not found|does not exist|no such (repository|ref|branch)/i.test(text)) return "The repository or branch could not be found.";
  if (/ENOTFOUND|ECONN|ETIMEDOUT|timed? ?out|could not resolve host|unable to access|network/i.test(text)) return "The repository could not be reached.";
  if (/spawn git|git: not found|'git' is not recognized|ENOENT/i.test(text)) return "Git is not installed on the server.";
  const first = text.split(/\r?\n/).find((line) => line.trim()) || text;
  const plain = first.replace(/^(fatal|error|warning):\s*/i, "").replace(/^[\w-]+:\s*/, "").split(" [ReqId")[0].trim();
  const cut = plain.length > 140 ? `${plain.slice(0, 137)}…` : plain;
  return /[.!?]$/.test(cut) ? cut : `${cut}.`;
}

export interface SyncState { tone: "ok" | "bad" | "neutral"; label: string; text: string }

/** What the dot and the footer say about a base: synced (and when), never synced, failed, or just a local folder. */
export function syncState(base: Pick<KnowledgeBase, "kind" | "lastSyncAt" | "lastError">): SyncState {
  if (base.lastError) return { tone: "bad", label: "Sync failed", text: "sync failed" };
  if (base.kind !== "git") return { tone: "neutral", label: "Local folder", text: "local folder" };
  if (base.lastSyncAt) return { tone: "ok", label: "Synced", text: `synced ${formatRelativeTime(base.lastSyncAt)}` };
  return { tone: "neutral", label: "Not synced yet", text: "not synced yet" };
}

/**
 * A cited path (`runbooks/veltrix-load.md`, with or without a leading `knowledge/`) becomes a base plus
 * a file inside it: the base whose folder name is the first segment, else the only base there is.
 */
export function locateCitedPath(bases: Array<Pick<KnowledgeBase, "name">>, cited: string): { base: string; file: string } | null {
  const clean = cited.replace(/^\/+/, "").replace(/^knowledge\//, "");
  if (!clean) return null;
  const [head, ...rest] = clean.split("/");
  const byFolder = bases.find((base) => base.name === head);
  if (byFolder && rest.length) return { base: byFolder.name, file: rest.join("/") };
  if (bases.length === 1) return { base: bases[0].name, file: clean };
  return null;
}

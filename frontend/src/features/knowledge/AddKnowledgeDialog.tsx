import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Folder } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { connectorKeys, connectorsApi } from "@/api/connectors";
import { knowledgeApi, knowledgeKeys, type RepositoryFolder, type RepositoryInspection } from "@/api/library";
import { settingsApi, settingsKeys } from "@/api/settings";
import { AGENT_NAME } from "@/components/ops/agentPanelContext";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input } from "@/components/ui";
import { cn } from "@/lib/utils";
import { DocumentPicker } from "./DocumentPicker";
import { toUploads, uploadProblem } from "./documentUploads";
import { useAction } from "@/lib/useAction";
import { Field } from "@/components/ops/Field";

/**
 * Add a knowledge base. Two sources:
 * - Git repository, in two steps: where it is and how to reach it ("Look inside" reads its folders
 *   without keeping anything), then which folders to use and a display name; "Add" clones only those.
 * - MCP server: one of the connected MCP systems (Confluence, a wiki) becomes the knowledge source
 *   the agent searches alongside the local bases. This writes operations.yaml `knowledge.connection`,
 *   the same setting the switch on Connectors controls.
 * - Uploaded documents: SOPs, decks, spreadsheets or PDFs become a new base. The backend keeps the
 *   files and starts a task that drafts pages from them (the knowledge-extract skill); the drafts
 *   wait in the base for a person to keep or discard.
 */

interface Access { url: string; branch: string; token: string; username: string }
const EMPTY: Access = { url: "", branch: "", token: "", username: "" };
type Source = "git" | "mcp" | "upload";
// Data and ticket systems hold records, not documentation; they are not offered as knowledge sources.
const DATA_SYSTEMS = new Set(["databricks", "snowflake", "servicenow", "jira", "atlassian"]);

export function AddKnowledgeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const [source, setSource] = useState<Source>("git");
  const [access, setAccess] = useState<Access>(EMPTY);
  const [found, setFound] = useState<RepositoryInspection | null>(null);
  const [title, setTitle] = useState("");
  const [whole, setWhole] = useState(true);
  const [chosen, setChosen] = useState<string[]>([]);
  const [server, setServer] = useState("");
  const [documents, setDocuments] = useState<File[]>([]);
  useEffect(() => { if (open) { setSource("git"); setAccess(EMPTY); setFound(null); setTitle(""); setWhole(true); setChosen([]); setServer(""); setDocuments([]); } }, [open]);

  const connectors = useQuery({ queryKey: connectorKeys.all, queryFn: ({ signal }) => connectorsApi.list(signal), enabled: open && source === "mcp" });
  const settings = useQuery({ queryKey: settingsKeys.all, queryFn: ({ signal }) => settingsApi.get(signal), enabled: open && source === "mcp" });
  const servers = useMemo(() => (connectors.data?.items ?? []).filter((item) => item.configured && (item.connectionKind || "mcp") === "mcp" && !DATA_SYSTEMS.has(item.id)), [connectors.data?.items]);
  const current = (settings.data?.operations.knowledge as { connection?: string } | undefined)?.connection || "";

  const credentials = () => ({ url: access.url.trim(), branch: access.branch.trim() || undefined, token: access.token.trim() || undefined, username: access.username.trim() || undefined });
  const inspect = useAction({
    mutationFn: () => knowledgeApi.inspect(credentials()),
    onSuccess: (result) => { setFound(result); setTitle((value) => value || result.suggestedTitle); setWhole(true); setChosen([]); },
    error: "Could not look inside",
    errorDetail: "The repository could not be read.",
  });
  const add = useAction({
    mutationFn: () => knowledgeApi.add({ title: title.trim(), ...credentials(), folders: whole ? [] : chosen }),
    invalidate: [knowledgeKeys.all],
    success: (base) => [`${base.title} added`, `${base.files} ${base.files === 1 ? "file" : "files"} cloned.`],
    onSuccess: (base) => { onOpenChange(false); navigate(`/knowledge/${encodeURIComponent(base.name)}`); },
    error: "Knowledge base not added",
    errorDetail: "The clone failed.",
  });
  const upload = useAction({
    mutationFn: async () => knowledgeApi.upload({ title: title.trim(), files: await toUploads(documents) }),
    invalidate: [knowledgeKeys.all],
    success: (base) => {
      const count = base.received.length;
      return [`${base.title} created`, base.taskId ? `${AGENT_NAME} is reading ${count} ${count === 1 ? "document" : "documents"}. Drafts appear in the base for review.` : base.lastError || "The documents are saved."];
    },
    onSuccess: (base) => { onOpenChange(false); navigate(`/knowledge/${encodeURIComponent(base.name)}`); },
    error: "Knowledge base not created",
    errorDetail: "The upload failed.",
  });
  const canUpload = Boolean(title.trim()) && documents.length > 0 && !uploadProblem(documents) && !upload.isPending;
  // operations.yaml `knowledge` is written whole: keep what is there and change only the MCP source.
  const useServer = useAction({
    mutationFn: () => { const knowledge = (settings.data?.operations.knowledge as Record<string, unknown> | undefined) ?? {}; return settingsApi.update("knowledge", { ...knowledge, path: knowledge.path || "knowledge", connection: server, mode: "both" }); },
    invalidate: [knowledgeKeys.all, settingsKeys.all, connectorKeys.all],
    success: [`${servers.find((item) => item.id === server)?.name || server} is a knowledge source`, `${AGENT_NAME} searches it alongside the knowledge bases from the next task.`],
    onSuccess: () => onOpenChange(false),
    error: "Not saved",
  });

  const pages = useMemo(() => (found ? (whole ? found.markdown : countChosen(found.folders, chosen) + found.rootFiles.filter(isMarkdown).length) : 0), [found, whole, chosen]);
  const toggle = (path: string) => setChosen((value) => value.includes(path) ? value.filter((item) => item !== path) : [...value.filter((item) => !item.startsWith(`${path}/`)), path]);
  const step = source === "mcp" ? "Pick a connected MCP server" : source === "upload" ? `Documents ${AGENT_NAME} turns into draft knowledge for you to review` : found ? "Step 2 of 2 · Choose the folders to use" : "Step 1 of 2 · A Git repository of markdown files";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Add knowledge base</DialogTitle>
          <DialogDescription>{step}</DialogDescription>
        </DialogHeader>
        {!found ? (
          <div className="px-5" role="radiogroup" aria-label="Source">
            <div className="grid gap-2 sm:grid-cols-3">
              {([["git", "Git repository", "Runbooks and definitions as markdown files, cloned and kept in sync."], ["mcp", "MCP server", `A connected system such as Confluence that ${AGENT_NAME} searches live.`], ["upload", "Upload documents", `SOPs, decks and PDFs that ${AGENT_NAME} turns into draft pages.`]] as const).map(([value, label, hint]) => (
                <label key={value} className={cn("flex cursor-pointer flex-col gap-0.5 rounded-xl border px-3 py-2.5 transition-colors", source === value ? "border-brand bg-raised" : "border-line bg-raised hover:border-line-strong")}>
                  <span className="flex items-center gap-2 text-[13.5px] font-semibold text-ink-1"><input type="radio" name="knowledge-source" value={value} checked={source === value} onChange={() => setSource(value)} className="h-3.5 w-3.5 accent-violet-600" />{label}</span>
                  <span className="text-[12.5px] leading-[18px] text-ink-4">{hint}</span>
                </label>
              ))}
            </div>
          </div>
        ) : null}
        {source === "upload" ? (
          <form id="kb-upload" className="space-y-3 px-5" onSubmit={(event) => { event.preventDefault(); if (canUpload) upload.mutate(); }}>
            <Field label="Name" htmlFor="kb-upload-title"><Input id="kb-upload-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Platform runbooks" autoComplete="off" disabled={upload.isPending} /></Field>
            <DocumentPicker files={documents} onChange={setDocuments} disabled={upload.isPending} />
            <p className="text-[12.5px] text-ink-5">Every page starts as a draft. Nothing becomes approved knowledge until a person keeps it.</p>
          </form>
        ) : source === "mcp" ? (
          <div className="space-y-3 px-5">
            {connectors.isPending ? <p className="text-[13.5px] text-ink-4">Loading connections</p> : servers.length ? (
              <div className="divide-y divide-line rounded-xl border border-line bg-raised" role="radiogroup" aria-label="MCP server">
                {servers.map((item) => (
                  <label key={item.id} className="flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-surface-subtle">
                    <input type="radio" name="knowledge-server" value={item.id} checked={server === item.id} onChange={() => setServer(item.id)} className="mt-1 h-3.5 w-3.5 accent-violet-600" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-[14px] font-medium text-ink-1">{item.name}{current === item.id ? <span className="rounded-md border border-line bg-surface-subtle px-1.5 py-px text-[11px] font-medium text-ink-4">current source</span> : null}</span>
                      {item.description ? <span className="mt-0.5 block text-[12.5px] leading-[18px] text-ink-4">{item.description}</span> : null}
                    </span>
                  </label>
                ))}
              </div>
            ) : <p className="text-[13.5px] leading-5 text-ink-4">No MCP server is connected yet. Add one on Connectors, then pick it here.</p>}
            <p className="text-[12.5px] text-ink-5">One MCP knowledge source at a time. The local knowledge bases stay available.</p>
          </div>
        ) : !found ? (
          <form id="kb-access" className="space-y-3 px-5" onSubmit={(event) => { event.preventDefault(); if (access.url.trim() && !inspect.isPending) inspect.mutate(); }}>
            <Field label="Repository URL" htmlFor="kb-url"><Input id="kb-url" className="font-mono text-[13px]" value={access.url} onChange={(event) => setAccess((value) => ({ ...value, url: event.target.value }))} placeholder="https://github.com/acme/data-ops-runbooks" autoComplete="off" /></Field>
            <Field label="Branch" htmlFor="kb-branch" hint="Optional. Blank uses the default branch."><Input id="kb-branch" className="font-mono text-[13px]" value={access.branch} onChange={(event) => setAccess((value) => ({ ...value, branch: event.target.value }))} placeholder="main" autoComplete="off" /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Access token" htmlFor="kb-token" hint="Optional. Stored in the secret store."><Input id="kb-token" type="password" value={access.token} onChange={(event) => setAccess((value) => ({ ...value, token: event.target.value }))} autoComplete="new-password" /></Field>
              <Field label="Token username" htmlFor="kb-username" hint="Optional. Bitbucket and Azure DevOps need one."><Input id="kb-username" value={access.username} onChange={(event) => setAccess((value) => ({ ...value, username: event.target.value }))} placeholder="x-access-token" autoComplete="off" /></Field>
            </div>
            <p className="text-[13px] text-ink-4">Public GitHub repositories need neither a token nor a username.</p>
          </form>
        ) : (
          <div className="space-y-3 px-5">
            <p className="truncate font-mono text-[12.5px] text-ink-4" title={found.url}>{found.url.replace(/^https?:\/\//i, "")}{found.branch ? ` · ${found.branch}` : ""}{found.commit ? ` · ${found.commit}` : ""}</p>
            <Field label="Name" htmlFor="kb-title"><Input id="kb-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Platform runbooks" autoComplete="off" /></Field>
            <div>
              <p className="mb-1 text-[13px] font-medium text-ink-3" id="kb-folders-label">Folders</p>
              <div className="max-h-[300px] overflow-y-auto rounded-xl border border-line bg-raised py-1" role="group" aria-labelledby="kb-folders-label">
                <label className="flex h-8 cursor-pointer items-center gap-2 px-3 text-[13.5px] font-medium text-ink-1 hover:bg-surface-subtle">
                  <input type="checkbox" className="h-4 w-4 accent-violet-600" checked={whole} onChange={(event) => { setWhole(event.target.checked); if (event.target.checked) setChosen([]); }} />
                  <span className="min-w-0 flex-1 truncate">Whole repository</span>
                  <Count value={found.markdown} />
                </label>
                {found.folders.length ? <FolderRows folders={found.folders} depth={0} whole={whole} chosen={chosen} onToggle={toggle} /> : <p className="px-3 py-2 text-[13px] text-ink-4">No folders</p>}
              </div>
              <p className="mt-1.5 text-[12.5px] text-ink-4">
                {whole ? `${found.markdown} ${plural(found.markdown, "page")}` : `${chosen.length} ${plural(chosen.length, "folder")} · ${pages} ${plural(pages, "page")}`}
                {!whole && found.rootFiles.length ? `. Files at the top level, such as ${found.rootFiles.find((file) => /^index\.md$/i.test(file)) || found.rootFiles[0]}, are always included.` : ""}
              </p>
            </div>
          </div>
        )}
        <DialogFooter>
          {found ? <Button variant="outline" onClick={() => setFound(null)} disabled={add.isPending} busy={add.isPending}>Back</Button> : <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>}
          {source === "upload"
            ? <Button variant="primary" type="submit" form="kb-upload" disabled={!canUpload} aria-busy={upload.isPending}>{upload.isPending ? "Uploading" : "Create knowledge base"}</Button>
            : source === "mcp"
            ? <Button variant="primary" disabled={!server || server === current || useServer.isPending} onClick={() => useServer.mutate()}>{useServer.isPending ? "Saving" : "Use as knowledge source"}</Button>
            : found
              ? <Button variant="primary" disabled={add.isPending || (!whole && !chosen.length)} onClick={() => add.mutate()}>{add.isPending ? "Adding" : "Add"}</Button>
              : <Button variant="primary" type="submit" form="kb-access" disabled={!access.url.trim() || inspect.isPending}>{inspect.isPending ? "Looking inside" : "Look inside"}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FolderRows({ folders, depth, whole, chosen, onToggle, covered = false }: { folders: RepositoryFolder[]; depth: number; whole: boolean; chosen: string[]; onToggle: (path: string) => void; covered?: boolean }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  return (
    <ul>
      {folders.map((folder) => {
        const inherited = whole || covered;
        const checked = inherited || chosen.includes(folder.path);
        const open = expanded[folder.path] ?? false;
        const hasChildren = folder.children.length > 0;
        return (
          <li key={folder.path}>
            <div className="flex h-8 items-center gap-1 pr-3 hover:bg-surface-subtle" style={{ paddingLeft: 6 + depth * 18 }}>
              {hasChildren ? (
                <button type="button" className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-5 hover:text-ink-2" aria-label={`${open ? "Collapse" : "Expand"} ${folder.name}`} aria-expanded={open} onClick={() => setExpanded((value) => ({ ...value, [folder.path]: !open }))}>
                  {open ? <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />}
                </button>
              ) : <span className="h-6 w-6 shrink-0" aria-hidden="true" />}
              <label className={cn("flex min-w-0 flex-1 items-center gap-2 text-[13.5px]", inherited ? "cursor-default text-ink-3" : "cursor-pointer text-ink-1")}>
                <input type="checkbox" className="h-4 w-4 accent-violet-600" checked={checked} disabled={inherited} onChange={() => onToggle(folder.path)} aria-label={folder.path} />
                <Folder className="h-3.5 w-3.5 shrink-0 text-ink-4" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                <Count value={folder.markdown} />
              </label>
            </div>
            {open && hasChildren ? <FolderRows folders={folder.children} depth={depth + 1} whole={whole} chosen={chosen} onToggle={onToggle} covered={checked} /> : null}
          </li>
        );
      })}
    </ul>
  );
}

function Count({ value }: { value: number }) {
  return <span className="shrink-0 text-[12.5px] tabular-nums text-ink-5">{value} {plural(value, "page")}</span>;
}

const isMarkdown = (file: string) => /\.(md|markdown)$/i.test(file);
const plural = (count: number, word: string) => (count === 1 ? word : `${word}s`);

/** Markdown pages under the chosen folders (a chosen folder counts everything below it). */
function countChosen(folders: RepositoryFolder[], chosen: string[]): number {
  let total = 0;
  const walk = (items: RepositoryFolder[]) => { for (const folder of items) { if (chosen.includes(folder.path)) total += folder.markdown; else walk(folder.children); } };
  walk(folders);
  return total;
}

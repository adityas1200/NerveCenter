import { refreshAfterWrite } from "@/lib/refreshAfterWrite";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, FileDiff, FileUp, Folder, GitBranch, Plug, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { knowledgeApi, knowledgeKeys, type KnowledgeBase, type KnowledgeList } from "@/api/library";
import { useCan } from "@/auth/rbac";
import { AGENT_NAME, useAgentScreen } from "@/components/ops/agentPanelContext";
import { EmptyState } from "@/components/ops/EmptyState";
import { FileWorkspace } from "@/components/ops/FileWorkspace";
import { OpsPage } from "@/components/ops/OpsPage";
import { OverflowMenu } from "@/components/ops/OverflowMenu";
import { PageHeader } from "@/components/ops/PageHeader";
import { Pager } from "@/components/ops/Pager";
import { RefreshButton } from "@/components/ops/RefreshButton";
import { QueryState } from "@/components/ops/StatePanels";
import { Button, Card, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Tabs, TabsList, TabsTrigger, useToast, confirmAction } from "@/components/ui";
import { Field } from "@/features/settings/SettingsShell";
import { defaultFile } from "@/lib/fileTree";
import { cn } from "@/lib/utils";
import { AddKnowledgeDialog } from "./AddKnowledgeDialog";
import { DocumentPicker } from "./DocumentPicker";
import { toUploads, uploadProblem } from "./documentUploads";
import { DraftsDialog } from "./DraftsDialog";
import { KnowledgeHealth } from "./KnowledgeHealth";
import { KnowledgeMap } from "./KnowledgeMap";
import { locateCitedPath, plainSyncError, syncState } from "./knowledgeText";
import { useAction } from "@/lib/useAction";
import { GRID_PAGE_SIZES, usePager } from "@/lib/usePager";

/**
 * Knowledge: the runbooks, definitions and SOPs the agent reads. The list is a grid of cards, one
 * per base; opening one gives it its own page with the file tree and index. Each base is a folder
 * under knowledge/ in the workspace: a Git repository (whole, or only some of its folders) that we
 * clone and sync, a local folder, a base built from uploaded documents, or an MCP server chosen
 * from the connected systems.
 */

/** Sync a Git base. Shared by the list cards and the base page's primary button. */
function useSync() {
  const toast = useToast();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => knowledgeApi.sync(name),
    onSuccess: async (base) => { await refreshAfterWrite(queryClient, { queryKey: knowledgeKeys.all }); toast.success(`${base.title} synced`, "The latest files are in the workspace."); },
    onError: (error) => toast.error("Sync failed", error instanceof Error ? plainSyncError(error.message) : "Try again."),
  });
}

export function KnowledgePage() {
  const { name } = useParams();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // SPEC-projects-03 FR-6: a project's developers and owners manage its knowledge; keeping Sonic's drafts is the owners'.
  const admin = useCan("knowledge.manage");
  // SPEC-knowledge-03 FR-3: the owner starts the knowledge setup, or picks up the one already open.
  const reviewer = useCan("knowledge.review");
  const setupTask = useQuery({ queryKey: knowledgeKeys.setup, queryFn: ({ signal }) => knowledgeApi.setupTask(signal), enabled: reviewer && !name });
  const [settingUp, setSettingUp] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addingDocuments, setAddingDocuments] = useState(false);
  const query = useQuery({ queryKey: knowledgeKeys.all, queryFn: ({ signal }) => knowledgeApi.list(signal) });
  const sync = useSync();
  const items = query.data?.items ?? [];
  const files = items.reduce((sum, item) => sum + item.files, 0);
  const selected = name ? items.find((item) => item.name === name) || null : null;
  const openFile = params.get("file");
  // `/knowledge?path=runbooks/x.md` (a citation in a reply) opens that file in its base's reader.
  const citedPath = name ? null : params.get("path");
  useEffect(() => {
    if (!citedPath || !query.data) return;
    const target = locateCitedPath(query.data.items, citedPath);
    if (target) navigate({ pathname: `/knowledge/${encodeURIComponent(target.base)}`, search: `?file=${encodeURIComponent(target.file)}`, hash: location.hash }, { replace: true });
  }, [citedPath, query.data, navigate, location.hash]);

  useAgentScreen(name
    ? { visible: [], open: { kind: "knowledge-base", id: name, title: selected?.title }, summary: `Reading ${openFile || "the index"} in knowledge base ${selected?.title || name}` }
    : { visible: items.map((item) => item.name), open: null, summary: `${items.length} knowledge ${items.length === 1 ? "base" : "bases"}, ${files} files${query.data?.mcp.connection ? `; also reads ${query.data.mcp.connection} over MCP` : ""}` });

  if (name) {
    const syncing = sync.isPending && sync.variables === name;
    // One button to bring the files up to date: Sync now on a Git base (it refetches too), the refresh icon otherwise.
    const canSync = admin && selected?.kind === "git";
    const drafts = selected?.pendingChanges || 0;
    const uploaded = selected?.kind === "upload" ? selected : null;
    const view = params.get("view") === "map" ? "map" : "files";
    return (
      <>
        <PageHeader
          title={selected?.title || name}
          back={{ to: "/knowledge", label: "Knowledge" }}
          count={selected ? sourceLine(selected) : undefined}
          actions={(
            <>
              {/* SPEC-knowledge-04 FR-11: the same base as files or as a map of its pages and typed links. */}
              <Tabs value={view} onValueChange={(next) => setParams((current) => { const updated = new URLSearchParams(current); if (next === "map") updated.set("view", "map"); else updated.delete("view"); return updated; })}>
                <TabsList aria-label="View">
                  <TabsTrigger value="files">Files</TabsTrigger>
                  <TabsTrigger value="map">Map</TabsTrigger>
                </TabsList>
              </Tabs>
              {/* Drafts hold sync back, so the way to them sits next to Sync now. */}
              {drafts ? <Button size="sm" variant="outline" className="border border-amber-200 bg-amber-50/60 text-amber-800 hover:border-amber-300 hover:text-amber-900" title="Sync waits until drafts are kept or discarded" onClick={() => setParams((current) => { const updated = new URLSearchParams(current); updated.set("drafts", "1"); return updated; })}><FileDiff className="h-3.5 w-3.5" aria-hidden="true" />Review drafts <span className="tabular-nums">{drafts}</span></Button> : null}
              {uploaded?.lastTaskId ? <Button asChild size="sm" variant="outline" className="border border-line"><Link to={`/tasks/${encodeURIComponent(uploaded.lastTaskId)}`} title={uploaded.documents?.join(", ") || undefined}>Follow {AGENT_NAME} reading them</Link></Button> : null}
              {canSync ? null : <RefreshButton onClick={() => { void query.refetch({ cancelRefetch: false }); void refreshAfterWrite(queryClient, { queryKey: knowledgeKeys.tree(name) }); void refreshAfterWrite(queryClient, { queryKey: knowledgeKeys.map(name) }); }} busy={query.isFetching} updatedAt={query.dataUpdatedAt} />}
            </>
          )}
          primary={canSync ? <Button variant="primary" size="sm" disabled={syncing} aria-busy={syncing} onClick={() => sync.mutate(name)}><RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />{syncing ? "Syncing" : "Sync now"}</Button>
            : admin && uploaded ? <Button variant="primary" size="sm" onClick={() => setAddingDocuments(true)}><FileUp className="h-3.5 w-3.5" aria-hidden="true" />Add documents</Button> : undefined}
        />
        {admin && uploaded ? <AddDocumentsDialog base={uploaded} open={addingDocuments} onOpenChange={setAddingDocuments} /> : null}
        <QueryState query={query} tiles={0}>
          <BaseBrowser base={selected} name={name} view={view} />
        </QueryState>
      </>
    );
  }
  return (
    <OpsPage
      title="Knowledge"
      count={query.data ? `${items.length} ${items.length === 1 ? "base" : "bases"} · ${files} ${files === 1 ? "file" : "files"}` : undefined}
      actions={<RefreshButton autoRefresh onClick={() => void query.refetch({ cancelRefetch: false })} busy={query.isFetching} updatedAt={query.dataUpdatedAt} />}
      primary={!reviewer || setupTask.isPending ? undefined : setupTask.data?.taskId
        ? <Button asChild variant="primary" size="sm"><Link to={`/tasks/${encodeURIComponent(setupTask.data.taskId)}`}><ClipboardList className="h-3.5 w-3.5" aria-hidden="true" />Continue setup</Link></Button>
        : <Button variant="primary" size="sm" onClick={() => setSettingUp(true)}><ClipboardList className="h-3.5 w-3.5" aria-hidden="true" />Set up knowledge</Button>}
    >
      <QueryState query={query} tiles={0}>
        <div className="space-y-6">
          {/* SPEC-knowledge-06 FR-8, SPEC-knowledge-07 FR-6: how well the knowledge works, and what the weekly pass found. */}
          {query.data?.items.length ? <KnowledgeHealth /> : null}
          <BaseList data={query.data!} admin={admin} onAdd={() => setAdding(true)} sync={sync} />
        </div>
      </QueryState>
      <AddKnowledgeDialog open={adding} onOpenChange={setAdding} />
      {reviewer ? <SetupKnowledgeDialog bases={items} open={settingUp} onOpenChange={setSettingUp} /> : null}
    </OpsPage>
  );
}

/** Where a base comes from, short: `github.com/acme/runbooks · main`, or its local folder. */
const sourceLine = (base: KnowledgeBase) => base.kind === "git" ? `${shortUrl(base.url || "")}${base.branch ? ` · ${base.branch}` : ""}` : base.kind === "upload" ? documentsLine(base.documents?.length ?? 0) : `Folder knowledge/${base.name}`;
const documentsLine = (count: number) => `${count} uploaded ${count === 1 ? "document" : "documents"}`;
/** `github.com/acme/runbooks` for a remote; the last two folders for a local path used in demos and air-gapped setups. */
const shortUrl = (url: string) => {
  if (/^([A-Za-z]:[\\/]|\/|file:)/.test(url)) { const parts = url.replace(/^file:\/+/, "").split(/[\\/]+/).filter(Boolean); return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : parts.join("/"); }
  return url.replace(/^https?:\/\//i, "").replace(/\.git$/i, "");
};
const humanize = (value: string) => { const text = value.replace(/[-_]+/g, " ").trim(); return text ? text.charAt(0).toUpperCase() + text.slice(1) : text; };
const KIND_LABEL: Record<string, string> = { git: "Git repository", local: "Local folder", upload: "Uploaded documents" };

/** "12 files · synced 2h ago", with the commit hash in the tooltip rather than on the card. */
function FilesLine({ base, className }: { base: KnowledgeBase; className?: string }) {
  const state = syncState(base);
  return <span className={cn("text-[12.5px] tabular-nums text-ink-5", className)} title={base.lastCommit ? `Commit ${base.lastCommit}` : undefined}>{base.files} {base.files === 1 ? "file" : "files"} · {state.text}</span>;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex gap-3"><dt className="w-[68px] shrink-0 text-ink-4">{label}</dt><dd className="min-w-0 flex-1">{children}</dd></div>;
}

function StateDot({ base }: { base: KnowledgeBase }) {
  const state = syncState(base);
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-[12.5px] font-medium text-ink-3">
      <i className={cn("inline-block h-2 w-2 rounded-full", state.tone === "ok" ? "bg-emerald-500" : state.tone === "bad" ? "bg-rose-500" : "bg-ink-5/40")} aria-hidden="true" />
      {state.label}
    </span>
  );
}

function BaseList({ data, admin, onAdd, sync }: { data: KnowledgeList; admin: boolean; onAdd: () => void; sync: ReturnType<typeof useSync> }) {
  const navigate = useNavigate();
  const remove = useAction({ mutationFn: (name: string) => knowledgeApi.remove(name), invalidate: [knowledgeKeys.all], success: "Knowledge base removed", error: "Not removed" });
  const pager = usePager(data.items.length, { sizes: GRID_PAGE_SIZES });
  return (
    <div className="space-y-4">
      {data.items.length ? (
        <ul className="stagger-children grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {pager.slice(data.items).map((base) => {
            const syncing = sync.isPending && sync.variables === base.name;
            return (
              <li key={base.name}>
                <Card className="flex h-full flex-col p-5" data-testid={`knowledge-${base.name}`}>
                  <div className="flex items-start justify-between gap-3">
                    {base.kind === "git" ? <GitBranch className="h-5 w-5 shrink-0 text-ink-5" aria-hidden="true" /> : base.kind === "upload" ? <FileUp className="h-5 w-5 shrink-0 text-ink-5" aria-hidden="true" /> : <Folder className="h-5 w-5 shrink-0 text-ink-5" aria-hidden="true" />}
                    <div className="pt-0.5"><StateDot base={base} /></div>
                  </div>
                  <button type="button" onClick={() => navigate(`/knowledge/${encodeURIComponent(base.name)}`)} className="flex flex-1 flex-col text-left focus-visible:outline-none">
                    <h2 className="mt-3 truncate text-[15.5px] font-semibold text-ink-1">{base.title}</h2>
                    <p className="mt-0.5 text-[13px] text-ink-4">{KIND_LABEL[base.kind] || humanize(base.kind)}</p>
                    {base.description ? <p className="mt-2 line-clamp-3 text-[13.5px] leading-5 text-ink-3" title={base.description}>{base.description}</p> : null}
                    <dl className="mt-3 space-y-1 text-[13.5px]">
                      <Row label="Source"><span className="block truncate text-[12.5px] text-ink-4" title={base.url || undefined}>{sourceLine(base)}</span></Row>
                      {base.folders?.length ? <Row label="Folders"><span className="block truncate text-ink-2" title={base.folders.join(", ")}>{base.folders.join(", ")}</span></Row> : null}
                      <Row label="Files"><FilesLine base={base} className="block text-ink-2" /></Row>
                      {base.lastError ? <Row label="Problem"><span className="break-words text-rose-700" title={base.lastError}>{plainSyncError(base.lastError)}</span></Row> : null}
                    </dl>
                    {base.pendingChanges ? <DraftsNote count={base.pendingChanges} className="mt-2" /> : null}
                  </button>
                  {admin ? (
                    <div className="mt-auto flex items-center gap-2 pt-5">
                      {base.kind === "git" ? <Button size="sm" variant="outline" className="border border-line" disabled={syncing} aria-busy={syncing} onClick={() => sync.mutate(base.name)}><RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />{syncing ? "Syncing" : "Sync"}</Button> : null}
                      <OverflowMenu className="ml-auto" label={`Actions for ${base.title}`} items={[{ label: "Remove", icon: Trash2, destructive: true, onSelect: () => { void confirmAction({ title: `Remove ${base.title}?`, description: `${AGENT_NAME} stops reading this knowledge base.`, confirmLabel: "Remove", destructive: true }).then((ok) => { if (ok) remove.mutate(base.name); }); } }]} />
                    </div>
                  ) : null}
                </Card>
              </li>
            );
          })}
          {admin ? (
            <li>
              <button type="button" onClick={onAdd} className="flex h-full min-h-[180px] w-full flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-line-strong p-5 text-[14px] font-semibold text-ink-3 transition-colors hover:border-ink-1 hover:text-ink-1">
                <Plus className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />Add knowledge base
                <span className="text-[12.5px] font-normal text-ink-4">Git repository, MCP server or uploaded documents</span>
              </button>
            </li>
          ) : null}
        </ul>
      ) : (
        <Card>
          <EmptyState
            illustration="knowledge"
            title="No knowledge bases"
            body={<>Add a Git repository of runbooks and definitions, upload your SOPs and documents, or pick a connected MCP server, and {AGENT_NAME} reads it before it acts.</>}
            action={admin ? <Button size="sm" variant="primary" onClick={onAdd}>Add knowledge base</Button> : undefined}
          />
        </Card>
      )}
      {data.items.length > GRID_PAGE_SIZES[0] ? <Card className="overflow-hidden"><Pager {...pager.pagerProps} noun="knowledge bases" /></Card> : null}
      {data.mcp.connection ? (
        <p className="flex flex-wrap items-center gap-x-1.5 text-[13.5px] text-ink-3"><Plug className="h-3.5 w-3.5 text-ink-5" aria-hidden="true" />{AGENT_NAME} also searches <span className="font-medium text-ink-1">{humanize(data.mcp.connection)}</span> over MCP.<Link to="/connectors" className="font-medium text-brand hover:text-brand-hover">Manage in Connectors</Link></p>
      ) : null}
    </div>
  );
}

/** Uncommitted files in a Git base are drafts the agent proposed; a sync would wipe them, so it waits. */
function DraftsNote({ count, className }: { count: number; className?: string }) {
  return (
    <span className={cn("block text-[13px] leading-5", className)}>
      <span className="font-medium text-ink-2"><span className="tabular-nums text-amber-700">{count}</span> {count === 1 ? "draft" : "drafts"} from {AGENT_NAME} to review</span>
      <span className="block text-[12.5px] text-ink-4">Sync waits until they are committed or removed.</span>
    </span>
  );
}

function BaseBrowser({ base, name, view = "files" }: { base: KnowledgeBase | null; name: string; view?: "files" | "map" }) {
  const reviewer = useCan("knowledge.review");
  const [params, setParams] = useSearchParams();
  // `?drafts=1` opens the review, so a link (a task step, a notification) can land on it.
  const reviewing = params.get("drafts") === "1";
  const setReviewing = (open: boolean) => setParams((current) => { const updated = new URLSearchParams(current); if (open) updated.set("drafts", "1"); else updated.delete("drafts"); return updated; });
  const tree = useQuery({ queryKey: knowledgeKeys.tree(name), queryFn: ({ signal }) => knowledgeApi.tree(name, signal), enabled: view === "files" });
  const path = params.get("file") ?? (tree.data ? defaultFile(tree.data.items, ["index.md", "README.md"]) : null);
  const file = useQuery({ queryKey: knowledgeKeys.file(name, path || ""), queryFn: ({ signal }) => knowledgeApi.file(name, path || "", signal), enabled: Boolean(path) && view === "files" });
  const openPage = (next: string) => setParams((current) => { const updated = new URLSearchParams(current); updated.set("file", next); updated.delete("view"); return updated; });
  // The file tree gets the whole left column; drafts are reviewed from the header button.
  return (
    <>
    {view === "map" ? <KnowledgeMap base={name} onOpenPage={openPage} /> : <FileWorkspace
      tree={tree.data?.items ?? []}
      selected={path}
      onSelect={(next) => setParams((current) => { const updated = new URLSearchParams(current); updated.set("file", next); return updated; })}
      fileHref={(next) => `?file=${encodeURIComponent(next)}`}
      file={file.data}
      loading={tree.isPending}
      error={tree.error || file.error}
      emptyText="This knowledge base is empty"
    />}
    {base ? <DraftsDialog base={name} title={base.title} open={reviewing} onOpenChange={setReviewing} canDecide={reviewer} review={base.review} proposals={base.proposals} onOpenFile={(file) => setParams((current) => { const updated = new URLSearchParams(current); updated.set("file", file); updated.delete("drafts"); return updated; })} /> : null}
    </>
  );
}

/** More documents for a base built from uploads; the task reads the new and changed ones. */
function AddDocumentsDialog({ base, open, onOpenChange }: { base: KnowledgeBase; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [files, setFiles] = useState<File[]>([]);
  useEffect(() => { if (open) setFiles([]); }, [open]);
  const add = useAction({
    mutationFn: async () => knowledgeApi.addDocuments(base.name, await toUploads(files)),
    invalidate: [knowledgeKeys.all],
    success: (result) => {
      const count = result.received.length;
      return [`${count} ${count === 1 ? "document" : "documents"} added`, result.taskId ? `${AGENT_NAME} is reading ${count === 1 ? "it" : "them"}. New drafts appear here for review.` : result.lastError || "The documents are saved."];
    },
    onSuccess: () => onOpenChange(false),
    error: "Documents not added",
    errorDetail: "The upload failed.",
  });
  const ready = files.length > 0 && !uploadProblem(files) && !add.isPending;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add documents to {base.title}</DialogTitle>
          <DialogDescription>{AGENT_NAME} reads the new and changed ones and drafts pages for review. A document with the same name replaces the earlier one.</DialogDescription>
        </DialogHeader>
        <div className="px-5"><DocumentPicker files={files} onChange={setFiles} disabled={add.isPending} /></div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={add.isPending} busy={add.isPending}>Cancel</Button>
          <Button variant="primary" disabled={!ready} aria-busy={add.isPending} onClick={() => add.mutate()}>{add.isPending ? "Uploading" : "Add documents"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const SETUP_DEFAULT = "team-knowledge";

/**
 * Start the knowledge setup (SPEC-knowledge-03 FR-1, FR-3): one task where Sonic reads what exists, keeps the interview
 * guide, and turns the meeting transcripts uploaded there into drafts for the chosen base.
 */
function SetupKnowledgeDialog({ bases, open, onOpenChange }: { bases: KnowledgeBase[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const [base, setBase] = useState(SETUP_DEFAULT);
  useEffect(() => { if (open) setBase(SETUP_DEFAULT); }, [open]);
  const options = [{ name: SETUP_DEFAULT, title: "Team knowledge" }, ...bases.filter((item) => item.name !== SETUP_DEFAULT).map((item) => ({ name: item.name, title: item.title }))];
  const start = useAction({
    mutationFn: () => knowledgeApi.setup(base === SETUP_DEFAULT ? undefined : base),
    invalidate: [knowledgeKeys.setup, knowledgeKeys.all],
    onSuccess: (result) => { onOpenChange(false); navigate(`/tasks/${encodeURIComponent(result.taskId)}`); },
    error: "Setup not started",
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Set up knowledge</DialogTitle>
          <DialogDescription>{AGENT_NAME} reads the project charter, past tickets and connected systems, drafts what it can, and lists the rest as interview questions. Upload each meeting transcript to the same chat.</DialogDescription>
        </DialogHeader>
        <div className="px-5">
          <Field label="Save drafts to" htmlFor="setup-base" help="Every page stays a draft until someone keeps it">
            <Select value={base} onValueChange={setBase}>
              <SelectTrigger id="setup-base" aria-label="Save drafts to"><SelectValue /></SelectTrigger>
              <SelectContent>{options.map((item) => <SelectItem key={item.name} value={item.name}>{item.title}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={start.isPending}>Cancel</Button>
          <Button variant="primary" disabled={start.isPending} aria-busy={start.isPending} onClick={() => start.mutate()}>{start.isPending ? "Starting" : "Start setup"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

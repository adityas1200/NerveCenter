import { useQuery } from "@tanstack/react-query";
import { Download, Eye } from "lucide-react";
import { useMemo } from "react";
import { tasksApi, taskKeys } from "@/api/tasks";
import { FileSource } from "@/components/ops/FileSource";
import { Markdown } from "@/components/ops/Markdown";
import { Sheet, SheetContent, SheetTitle, Skeleton } from "@/components/ui";
import { formatBytes, splitFrontmatter } from "@/lib/frontmatter";
import { parseDelimited } from "./delimited";

/**
 * Opens one task file beside the task, so the journey and the rail stay visible. Markdown, diagrams,
 * images, tables, code, HTML and PDF render in place; Office files offer a download.
 */

type Kind = "markdown" | "mermaid" | "table" | "code" | "image" | "html" | "pdf" | "download";
const TEXT_KINDS = new Set<Kind>(["markdown", "mermaid", "table", "code"]);

function fileKind(path: string): Kind {
  const ext = (path.split(".").pop() || "").toLowerCase();
  if (ext === "md" || ext === "markdown") return "markdown";
  if (ext === "mmd" || ext === "mermaid") return "mermaid";
  if (ext === "csv" || ext === "tsv") return "table";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "image";
  if (ext === "html" || ext === "htm") return "html";
  if (ext === "pdf") return "pdf";
  if (["json", "yaml", "yml", "py", "sql", "txt", "log", "sh", "ps1", "js", "ts", "tsx", "mjs", "xml", "toml", "ini", "cfg", "env", "jsonl", "ndjson"].includes(ext) || !ext) return "code";
  return "download";
}

export function FileViewerSheet({ taskId, path, size, onClose, onOpenFile }: { taskId: string; path: string | null; size?: number; onClose: () => void; onOpenFile: (path: string) => void }) {
  const kind = path ? fileKind(path) : "download";
  const rawUrl = path ? tasksApi.fileUrl(taskId, path) : "";
  const text = useQuery({ queryKey: [...taskKeys.detail(taskId), "file", path], queryFn: ({ signal }) => tasksApi.fileContent(taskId, path || "", signal), enabled: Boolean(path) && TEXT_KINDS.has(kind), retry: false });
  const name = path ? path.split("/").pop() || path : "";
  const bytes = text.data?.size ?? size;
  return (
    <Sheet open={Boolean(path)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[min(62vw,1100px)]">
        <header className="flex items-center gap-3 border-b border-line px-5 py-3 pr-14">
          <div className="min-w-0 flex-1">
            <SheetTitle className="truncate text-[14.5px] font-semibold text-ink-1">{name}</SheetTitle>
            <p className="truncate font-mono text-[11.5px] text-ink-5">{path}{bytes !== undefined ? ` · ${formatBytes(bytes)}` : ""}</p>
          </div>
      <a href={rawUrl} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-ink-3 transition-colors hover:bg-surface-subtle hover:text-ink-1"><Eye className="h-3.5 w-3.5" aria-hidden="true" />Open</a>
          <a href={rawUrl} download={name} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-ink-3 transition-colors hover:bg-surface-subtle hover:text-ink-1"><Download className="h-3.5 w-3.5" aria-hidden="true" />Download</a>
        </header>
        <div className="min-h-0 flex-1 overflow-auto">
          {path ? <FileBody kind={kind} path={path} rawUrl={rawUrl} taskId={taskId} content={text.data?.content} loading={text.isPending && TEXT_KINDS.has(kind)} error={text.error} onOpenFile={onOpenFile} /> : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function FileBody({ kind, path, rawUrl, taskId, content, loading, error, onOpenFile }: { kind: Kind; path: string; rawUrl: string; taskId: string; content?: string; loading: boolean; error: unknown; onOpenFile: (path: string) => void }) {
  if (error) return <p className="p-5 text-[13.5px] text-rose-700">{error instanceof Error ? error.message : "The file could not be read."}</p>;
  if (loading) return <div className="space-y-3 p-5"><Skeleton className="h-4 w-48" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-5/6" /><Skeleton className="h-3 w-2/3" /></div>;
  if (kind === "image") return <div className="flex min-h-full items-center justify-center bg-surface-subtle p-6"><img src={rawUrl} alt={path} className="max-h-[80vh] max-w-full rounded-lg border border-line bg-raised" /></div>;
  if (kind === "html") return <iframe title={path} src={rawUrl} sandbox="" className="h-full min-h-[70vh] w-full bg-raised" />;
  if (kind === "pdf") return <iframe title={path} src={rawUrl} className="h-full min-h-[80vh] w-full" />;
  if (kind === "download") return <DownloadCard path={path} rawUrl={rawUrl} />;
  if (content === undefined) return null;
  if (kind === "markdown") return <MarkdownFile content={content} taskId={taskId} path={path} onOpenFile={onOpenFile} />;
  if (kind === "table") return <DelimitedTable content={content} delimiter={/\.tsv$/i.test(path) ? "\t" : ","} />;
  return <FileSource path={path} content={content} diagram={kind === "mermaid"} className="p-5" maxHeight="78vh" />;
}

function MarkdownFile({ content, taskId, path, onOpenFile }: { content: string; taskId: string; path: string; onOpenFile: (path: string) => void }) {
  const { meta, body } = useMemo(() => splitFrontmatter(content), [content]);
  return (
    <div className="mx-auto max-w-3xl px-6 py-5">
      {meta.length ? <dl className="mb-5 grid gap-x-6 gap-y-1 border-b border-line pb-4 text-[13.5px] sm:grid-cols-[auto_1fr]" aria-label="Metadata">{meta.map(([key, value]) => <div key={key} className="contents"><dt className="text-ink-4">{key}</dt><dd className="min-w-0 break-words text-ink-1">{value}</dd></div>)}</dl> : null}
      <Markdown className="text-[14.5px]" taskFilePath={path} onOpenFile={onOpenFile} resolveAsset={(src) => tasksApi.fileUrl(taskId, src)}>{body}</Markdown>
    </div>
  );
}

const TABLE_LIMIT = 500;
function DelimitedTable({ content, delimiter }: { content: string; delimiter: string }) {
  const rows = useMemo(() => parseDelimited(content, delimiter), [content, delimiter]);
  if (!rows.length) return <p className="p-5 text-[13.5px] text-ink-4">Empty file</p>;
  const [header, ...body] = rows;
  const shown = body.slice(0, TABLE_LIMIT);
  return (
    <div className="p-5">
      <div className="overflow-auto rounded-xl border border-line">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 bg-surface-subtle text-left text-[11.5px] uppercase tracking-[0.06em] text-ink-5">
            <tr>{header.map((cell, index) => <th key={index} className="whitespace-nowrap px-3 py-2 font-semibold">{cell}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-line">
            {shown.map((row, rowIndex) => <tr key={rowIndex} className="hover:bg-surface-subtle/60">{header.map((_cell, cellIndex) => <td key={cellIndex} className="max-w-[320px] truncate px-3 py-1.5 text-ink-2" title={row[cellIndex]}>{row[cellIndex] ?? ""}</td>)}</tr>)}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[12.5px] text-ink-5">{body.length > TABLE_LIMIT ? `First ${TABLE_LIMIT} of ${body.length} rows. Download for the rest.` : `${body.length} ${body.length === 1 ? "row" : "rows"}`}</p>
    </div>
  );
}

function DownloadCard({ path, rawUrl }: { path: string; rawUrl: string }) {
  const name = path.split("/").pop() || path;
  return (
    <div className="flex min-h-[40vh] items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-raised p-5 text-center">
        <p className="text-[14.5px] font-semibold text-ink-1">{name}</p>
        <p className="mt-1 text-[13px] text-ink-4">This file opens in its own application.</p>
        <a href={rawUrl} download={name} className="mt-4 inline-flex h-9 items-center gap-2 rounded-xl bg-brand px-4 text-[14px] font-semibold text-white transition-colors hover:bg-brand-hover"><Download className="h-4 w-4" aria-hidden="true" />Download</a>
      </div>
    </div>
  );
}

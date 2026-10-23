import { Eye, FileCode2, FileImage, FileSpreadsheet, FileText, GitFork, type LucideIcon } from "lucide-react";
import { formatBytes } from "@/lib/frontmatter";
import { cn } from "@/lib/utils";

export interface ArtifactRef { name: string; path: string; size?: number; openable: boolean; at?: string }

const ICONS: Array<[RegExp, LucideIcon]> = [
  [/\.(png|jpe?g|gif|webp|svg)$/i, FileImage],
  [/\.(csv|tsv|xlsx)$/i, FileSpreadsheet],
  [/\.(mmd|mermaid)$/i, GitFork],
  [/\.(json|ya?ml|py|sql|sh|ps1|js|ts|html?)$/i, FileCode2],
];
function artifactIcon(name: string): LucideIcon { return ICONS.find(([pattern]) => pattern.test(name))?.[1] || FileText; }
function artifactType(name: string): string {
  const ext = (name.split(".").pop() || "").toLowerCase();
  const map: Record<string, string> = { md: "Report", markdown: "Report", mmd: "Diagram", mermaid: "Diagram", csv: "Table", tsv: "Table", xlsx: "Workbook", pptx: "Deck", docx: "Document", pdf: "PDF", png: "Image", jpg: "Image", jpeg: "Image", svg: "Image", json: "JSON", yaml: "YAML", yml: "YAML", py: "Script", sql: "Query", html: "Page", htm: "Page", txt: "Text", log: "Log" };
  return map[ext] || ext.toUpperCase() || "File";
}

/** A file name that may wrap only after - _ . (a zero-width space after each), never mid-word. */
const breakable = (name: string) => name.replace(/([-_.])/g, "$1\u200b");

/**
 * A file the task made. Openable files are a card that opens the viewer, with an Open cue on hover. A
 * file the agent named but that is not in the task folder says so in words, and why it will not open.
 * In the Details sheet (`compact`) long names wrap onto a second line instead of being cut off.
 */
export function ArtifactCard({ file, onOpen, compact = false, shown = false }: { file: ArtifactRef; onOpen: (path: string) => void; compact?: boolean; /** The agent showed this file as an artifact: it gets the chip. */ shown?: boolean }) {
  const Icon = artifactIcon(file.name);
  const meta = [artifactType(file.name), file.size !== undefined ? formatBytes(file.size) : null].filter(Boolean).join(" · ");
  const body = (
    <>
      <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border", file.openable ? "border-line bg-surface-panel text-ink-3 group-hover:border-brand/30 group-hover:bg-brand-soft group-hover:text-brand" : "border-dashed border-line text-ink-5")} aria-hidden="true"><Icon className="h-4 w-4" /></span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start gap-1.5"><span className={cn("min-w-0 text-[13.5px] font-medium leading-5", compact ? "line-clamp-2 break-words" : "truncate", file.openable ? "text-ink-1" : "text-ink-3")} title={file.name}>{compact ? breakable(file.name) : file.name}</span>{shown ? <span className="mt-0.5 shrink-0 rounded-md border border-line bg-surface-subtle px-1.5 py-px text-[12px] font-medium text-ink-4">Artifact</span> : null}</span>
        <span className="block truncate text-[11.5px] leading-4 text-ink-5">{file.openable ? meta : "Not in the task folder, so it can't be opened here"}</span>
      </span>
      {file.openable ? <span className="flex shrink-0 items-center gap-1 text-[12px] font-medium text-brand opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true">Open<Eye className="h-3.5 w-3.5" /></span> : null}
    </>
  );
  if (!file.openable) return <div className="flex items-center gap-2.5 rounded-xl border border-dashed border-line bg-raised/60 px-2.5 py-2 text-left" title={`${file.path} is not in this task's folder.`}>{body}</div>;
  return <button type="button" onClick={() => onOpen(file.path)} title={`Open ${file.name}`} className="group flex w-full items-center gap-2.5 rounded-xl border border-line bg-raised px-2.5 py-2 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all hover:-translate-y-px hover:border-brand/30 hover:shadow-[0_4px_12px_-6px_rgba(99,102,241,0.35)]">{body}</button>;
}

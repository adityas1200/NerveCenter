import { ChevronDown, ChevronRight, FileText, Folder, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import type { FileContent, TreeNode } from "@/api/library";
import { FileSource } from "@/components/ops/FileSource";
import { FrontmatterHeader } from "@/components/ops/FrontmatterHeader";
import { Markdown, scrollToHeading } from "@/components/ops/Markdown";
import { SearchInput, Skeleton, useToast } from "@/components/ui";
import { ancestorsOf, resolveTreeTarget } from "@/lib/fileTree";
import { formatBytes, parseFrontmatter } from "@/lib/frontmatter";
import { cn } from "@/lib/utils";
import { splitterKeys, useSplitterDrag } from "./useSplitter";

/** The file pane's width on wide screens: dragged between the bounds, remembered across visits. */
const PANE_KEY = "nc.fileWorkspace.pane";
const ABOUT_KEY = "nc.fileWorkspace.aboutHeight";
const ABOUT_DEFAULT = 240;
const ABOUT_MIN = 56;
const PANE_DEFAULT = 280;
const PANE_MIN = 220;
const PANE_MAX = 560;
const PANE_RAIL = 48;
const clampPane = (width: number) => Math.min(PANE_MAX, Math.max(PANE_MIN, Math.round(width)));

function readPane(): { width: number; collapsed: boolean } {
  try {
    const saved = JSON.parse(window.localStorage.getItem(PANE_KEY) || "null") as { width?: number; collapsed?: boolean } | null;
    return { width: clampPane(Number(saved?.width) || PANE_DEFAULT), collapsed: Boolean(saved?.collapsed) };
  } catch { return { width: PANE_DEFAULT, collapsed: false }; }
}

/**
 * Full-height, two-pane reader for Skills and Knowledge: the file tree on the left, the open file
 * on the right, each scrolling on its own. Markdown renders with its frontmatter as a properties
 * header; relative links open the target file here (resolved against the open file's folder) and
 * the tree follows; `file.md#section` scrolls to the heading. Diagrams draw; anything else shows as
 * code. Read-only; the agent edits through tasks. On wide screens the file pane is resizable (drag or
 * arrow keys on its edge, double-click to reset) and folds down to a rail.
 */
export function FileWorkspace({ tree, selected, onSelect, file, loading, error, emptyText = "No files", aside, fileHref }: { tree: TreeNode[]; selected: string | null; onSelect: (path: string) => void; file: FileContent | null | undefined; loading?: boolean; error?: unknown; emptyText?: string; aside?: ReactNode; fileHref?: (path: string, anchor?: string) => string }) {
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [pendingAnchor, setPendingAnchor] = useState<string | null>(null);
  const [pane, setPane] = useState(readPane);
  // The description/files split: a horizontal handle between them, dragged up or down.
  const column = useRef<HTMLDivElement>(null);
  const [aboutHeight, setAboutHeight] = useState(() => { try { const saved = Number(window.localStorage.getItem(ABOUT_KEY)); return saved >= ABOUT_MIN ? saved : ABOUT_DEFAULT; } catch { return ABOUT_DEFAULT; } });
  // Leave the files at least ~140px (their header, the search box and a few rows).
  const aboutMax = () => Math.max(ABOUT_MIN, (column.current?.clientHeight || 640) - 140);
  const setAbout = (height: number) => setAboutHeight(Math.round(Math.min(aboutMax(), Math.max(ABOUT_MIN, height))));
  useEffect(() => { try { window.localStorage.setItem(ABOUT_KEY, String(aboutHeight)); } catch { /* storage is optional */ } }, [aboutHeight]);
  // Whether the description continues below what is visible, for the fade and "Show more".
  const aboutBox = useRef<HTMLDivElement>(null);
  const [aboutMore, setAboutMore] = useState(false);
  const checkAboutMore = () => { const box = aboutBox.current; if (box) setAboutMore(box.scrollHeight - box.scrollTop - box.clientHeight > 4); };
  useEffect(() => {
    checkAboutMore();
    const box = aboutBox.current;
    if (!box || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(checkAboutMore);
    observer.observe(box);
    if (box.firstElementChild) observer.observe(box.firstElementChild);
    return () => observer.disconnect();
  }, [aboutHeight, aside]);
  // Open the description to fit its text; when the column can't fit it all, scroll it on instead.
  const showAllAbout = () => {
    const box = aboutBox.current;
    if (!box) return;
    const wanted = box.scrollHeight + 2;
    if (aboutHeight < aboutMax() && wanted > aboutHeight) setAbout(wanted);
    else box.scrollBy?.({ top: box.clientHeight * 0.8, behavior: "smooth" });
  };
  const { dragging: draggingAbout, onPointerDown: startAboutDrag } = useSplitterDrag("y", () => aboutHeight, setAbout);
  const resizeAboutWithKeys = (event: ReactKeyboardEvent<HTMLDivElement>) => splitterKeys(event, { shrink: "ArrowUp", grow: "ArrowDown", size: aboutHeight, set: setAbout, min: ABOUT_MIN, max: aboutMax, onEnter: () => setAbout(ABOUT_DEFAULT) });
  const viewer = useRef<HTMLDivElement>(null);
  const nav = useRef<HTMLElement>(null);
  const term = search.trim().toLowerCase();
  const visible = useMemo(() => (term ? filterTree(tree, term) : tree), [tree, term]);
  const count = useMemo(() => countFiles(tree), [tree]);

  // The tree follows the open file: its folders open and its row scrolls into view.
  useEffect(() => {
    if (!selected) return undefined;
    const folders = ancestorsOf(selected);
    if (folders.length) setCollapsed((current) => (folders.some((folder) => current[folder] !== false) ? { ...current, ...Object.fromEntries(folders.map((folder) => [folder, false])) } : current));
    // After the folders have opened, so the row exists.
    const frame = requestAnimationFrame(() => nav.current?.querySelector<HTMLElement>(`[data-path=${JSON.stringify(selected)}]`)?.scrollIntoView?.({ block: "nearest" }));
    return () => cancelAnimationFrame(frame);
  }, [selected]);

  // A new file starts at the top, or at the heading its link pointed to.
  useEffect(() => {
    if (!file || file.path !== selected) return;
    if (pendingAnchor) { scrollToHeading(viewer.current, pendingAnchor); setPendingAnchor(null); }
    else viewer.current?.scrollTo?.({ top: 0 });
    // Only when the displayed file changes; the anchor is consumed once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.path, file?.content, selected]);

  useEffect(() => {
    try { window.localStorage.setItem(PANE_KEY, JSON.stringify(pane)); } catch { /* storage is optional */ }
  }, [pane]);

  const setWidth = (width: number) => setPane({ width: clampPane(width), collapsed: false });
  const toggleCollapsed = () => setPane((current) => ({ ...current, collapsed: !current.collapsed }));
  const { dragging, onPointerDown: startDrag } = useSplitterDrag("x", () => (pane.collapsed ? PANE_MIN : pane.width), setWidth);
  const resizeWithKeys = (event: ReactKeyboardEvent<HTMLDivElement>) => splitterKeys(event, { shrink: "ArrowLeft", grow: "ArrowRight", size: pane.width, set: setWidth, min: PANE_MIN, max: () => PANE_MAX, onEnter: toggleCollapsed });

  const openLink = (path: string, anchor?: string) => {
    const target = resolveTreeTarget(tree, path);
    if (!target) { toast.error("File not found", path || "This link points to nothing in this folder."); return; }
    if (target === selected) { if (anchor) scrollToHeading(viewer.current, anchor); return; }
    setPendingAnchor(anchor || null);
    onSelect(target);
  };

  return (
    <div
      className={cn("grid h-[calc(100dvh-var(--shell-chrome))] min-h-0 grid-cols-1 overflow-hidden lg:grid-cols-[var(--file-pane)_minmax(0,1fr)]", dragging ? "cursor-col-resize select-none" : "transition-[grid-template-columns] duration-200 ease-out")}
      style={{ "--file-pane": `${pane.collapsed ? PANE_RAIL : pane.width}px` } as CSSProperties}
    >
      <aside className="relative flex min-h-0 min-w-0 flex-col border-b border-line bg-raised lg:border-b-0 lg:border-r" aria-label="Files">
        {pane.collapsed ? (
          <div className="hidden animate-fade-in flex-col items-center gap-2 pt-3 lg:flex">
            <button type="button" onClick={toggleCollapsed} aria-label="Show files" title="Show files" className="grid h-8 w-8 place-items-center rounded-lg text-ink-4 transition-colors hover:bg-violet-50 hover:text-violet-600">
              <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
            </button>
            <span className="text-[11px] font-semibold tabular-nums text-ink-5" title={`${count} ${count === 1 ? "file" : "files"}`}>{count}</span>
          </div>
        ) : null}
        <div ref={column} className={cn("flex min-h-0 flex-1 flex-col", pane.collapsed && "lg:hidden", draggingAbout && "cursor-row-resize select-none")}>
          {aside ? (
            <>
              {/* The description scrolls inside the height the reader gives it; the files get the rest.
                  When it continues below the fold, a fade and "Show more" say so - a clean cut-off
                  line otherwise reads as the end. */}
              <div className="relative min-h-0 shrink-0" style={{ height: aboutHeight }}>
                <div ref={aboutBox} onScroll={checkAboutMore} className="h-full overflow-y-auto overscroll-contain px-4 py-3">{aside}</div>
                {aboutMore ? (
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-14 items-end justify-center bg-gradient-to-t from-[var(--ops-surface-raised)] via-[var(--ops-surface-raised)] to-transparent pb-1.5">
                    <button type="button" onClick={showAllAbout} className="pointer-events-auto inline-flex items-center gap-1 rounded-full border border-line bg-raised px-2.5 py-0.5 text-[12px] font-medium text-ink-3 shadow-sm transition-colors hover:border-violet-200 hover:text-violet-700">
                      Show more <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                ) : null}
              </div>
              {/* A focusable separator is the ARIA window-splitter pattern; the rule doesn't know it. */}
              {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
              <div
                role="separator"
                aria-orientation="horizontal"
                aria-label="Resize the description and the file list"
                aria-valuenow={aboutHeight}
                aria-valuemin={ABOUT_MIN}
                // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
                tabIndex={0}
                title="Drag up or down · double-click to reset"
                onPointerDown={startAboutDrag}
                onDoubleClick={() => setAbout(ABOUT_DEFAULT)}
                onKeyDown={resizeAboutWithKeys}
                className={cn("group relative h-2.5 shrink-0 cursor-row-resize border-y border-line bg-surface-subtle transition-colors hover:bg-violet-50 focus-visible:bg-violet-50 focus-visible:outline-none", draggingAbout && "bg-violet-100")}
              >
                <span aria-hidden="true" className={cn("absolute left-1/2 top-1/2 h-1 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink-5/40 transition-colors group-hover:bg-violet-400 group-focus-visible:bg-violet-500", draggingAbout && "bg-violet-500")} />
              </div>
            </>
          ) : null}
          <p className="shrink-0 px-4 pt-3 text-[12px] font-medium text-ink-5">Files <span className="ml-1 tabular-nums text-ink-5/80">{count}</span></p>
          <div className="flex shrink-0 items-center gap-1.5 px-3 pb-1 pt-2">
            <SearchInput className="min-w-0 flex-1" inputClassName="h-8 bg-surface-subtle text-[13.5px] shadow-none" label="Search files" placeholder="Search files" value={search} onValueChange={setSearch} />
            <button type="button" onClick={toggleCollapsed} aria-label="Hide files" title="Hide files" className="hidden h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-4 transition-colors hover:bg-violet-50 hover:text-violet-600 lg:grid">
              <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <nav ref={nav} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3 pt-1">
          {loading ? <div className="space-y-2 px-2 py-2"><Skeleton className="h-3 w-3/4" /><Skeleton className="h-3 w-1/2" /><Skeleton className="h-3 w-2/3" /></div>
            : visible.length ? <TreeList nodes={visible} depth={0} selected={selected} onSelect={onSelect} collapsed={collapsed} onToggle={(path, isOpen) => setCollapsed((current) => ({ ...current, [path]: isOpen }))} forceOpen={Boolean(term)} />
            : <p className="px-2 py-4 text-[13.5px] text-ink-4">{tree.length ? "No files match" : emptyText}</p>}
          </nav>
        </div>
        {/* A focusable separator is the ARIA window-splitter pattern; the rule doesn't know it. */}
        {/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize files pane"
          aria-valuemin={PANE_MIN}
          aria-valuemax={PANE_MAX}
          aria-valuenow={pane.collapsed ? PANE_RAIL : pane.width}
          tabIndex={0}
          title="Drag to resize · double-click to reset"
          onPointerDown={startDrag}
          onDoubleClick={() => setWidth(PANE_DEFAULT)}
          onKeyDown={resizeWithKeys}
          className="group/handle absolute -right-1.5 top-0 z-20 hidden h-full w-3 cursor-col-resize touch-none focus-visible:outline-none lg:block"
        >
          <span className={cn("absolute left-1/2 top-0 h-full w-0.5 -translate-x-1/2 transition-colors duration-150 group-hover/handle:bg-violet-300 group-focus-visible/handle:bg-violet-400", dragging ? "bg-violet-400" : "bg-transparent")} aria-hidden="true" />
        </div>
        {/* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
      </aside>
      <section className="flex min-h-0 min-w-0 flex-col" aria-label="File">
        <div className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-line bg-raised px-5">
          <p className="truncate font-mono text-[13px] text-ink-3">{file?.path || selected || ""}</p>
          {file ? <span className="shrink-0 text-[12.5px] tabular-nums text-ink-5">{formatBytes(file.size)}</span> : null}
        </div>
        <div ref={viewer} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {error ? <p className="p-6 text-[13.5px] text-rose-700">{error instanceof Error ? error.message : "The file could not be read."}</p>
            : loading ? <div className="space-y-3 p-6"><Skeleton className="h-4 w-48" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-5/6" /><Skeleton className="h-3 w-2/3" /></div>
            : !selected ? <p className="p-6 text-[13.5px] text-ink-4">Pick a file</p>
            : file ? <FileView file={file} onOpenLink={openLink} fileHref={fileHref} /> : <div className="space-y-3 p-6"><Skeleton className="h-4 w-48" /><Skeleton className="h-3 w-full" /></div>}
        </div>
      </section>
    </div>
  );
}

function TreeList({ nodes, depth, selected, onSelect, collapsed, onToggle, forceOpen }: { nodes: TreeNode[]; depth: number; selected: string | null; onSelect: (path: string) => void; collapsed: Record<string, boolean>; onToggle: (path: string, isOpen: boolean) => void; forceOpen: boolean }) {
  return (
    <ul className="space-y-px">
      {nodes.map((node) => {
        const open = forceOpen || !(collapsed[node.path] ?? depth >= 1);
        if (node.type === "directory") {
          return (
            <li key={node.path}>
              <button type="button" onClick={() => onToggle(node.path, open)} aria-expanded={open} className="flex h-7 w-full items-center gap-1.5 rounded-lg px-2 text-left text-[13.5px] font-medium text-ink-2 hover:bg-surface-subtle" style={{ paddingLeft: 8 + depth * 14 }}>
                {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-5" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-5" aria-hidden="true" />}
                <Folder className="h-3.5 w-3.5 shrink-0 text-ink-4" aria-hidden="true" /><span className="truncate">{node.name}</span>
              </button>
              {open && node.children?.length ? <TreeList nodes={node.children} depth={depth + 1} selected={selected} onSelect={onSelect} collapsed={collapsed} onToggle={onToggle} forceOpen={forceOpen} /> : null}
            </li>
          );
        }
        const active = node.path === selected;
        return (
          <li key={node.path}>
            <button type="button" data-path={node.path} onClick={() => onSelect(node.path)} aria-current={active ? "true" : undefined} className={cn("flex h-7 w-full items-center gap-1.5 rounded-lg px-2 text-left text-[13.5px] transition-colors", active ? "bg-brand/[0.08] font-semibold text-brand" : "text-ink-2 hover:bg-surface-subtle")} style={{ paddingLeft: 8 + depth * 14 + 18 }}>
              <FileText className={cn("h-3.5 w-3.5 shrink-0", active ? "text-brand" : "text-ink-4")} aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{node.name}</span><span className="shrink-0 font-mono text-[11px] text-ink-5">{formatBytes(node.size)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function FileView({ file, onOpenLink, fileHref }: { file: FileContent; onOpenLink: (path: string, anchor?: string) => void; fileHref?: (path: string, anchor?: string) => string }) {
  const markdown = /\.(md|markdown)$/i.test(file.path);
  const mermaid = /\.(mmd|mermaid)$/i.test(file.path);
  const { properties, body } = useMemo(() => (markdown ? parseFrontmatter(file.content) : { properties: [], body: file.content }), [markdown, file.content]);
  if (mermaid || !markdown) return <FileSource path={file.path} content={file.content} diagram={mermaid} className="p-6" maxHeight="calc(100vh - 200px)" />;
  // OKF files carry their title in frontmatter; show it when the body has no heading of its own.
  const title = properties.find(([key]) => key === "title")?.[1];
  const showTitle = typeof title === "string" && title && !/^\s*#\s/m.test(body.split(/\r?\n/).slice(0, 8).join("\n"));
  return (
    <article className="mx-auto max-w-3xl px-6 py-6">
      {showTitle ? <h1 className="mb-2 text-[18px] font-semibold text-ink-1">{title}</h1> : null}
      <FrontmatterHeader properties={properties} />
      <Markdown className="text-[14.5px]" currentPath={file.path} onOpenFile={onOpenLink} fileHref={fileHref}>{body}</Markdown>
    </article>
  );
}

function filterTree(nodes: TreeNode[], term: string): TreeNode[] {
  const out: TreeNode[] = [];
  for (const node of nodes) {
    if (node.type === "directory") { const children = filterTree(node.children || [], term); if (children.length || node.name.toLowerCase().includes(term)) out.push({ ...node, children: children.length ? children : node.children }); }
    else if (node.name.toLowerCase().includes(term) || node.path.toLowerCase().includes(term)) out.push(node);
  }
  return out;
}

function countFiles(nodes: TreeNode[]): number { return nodes.reduce((sum, node) => sum + (node.type === "directory" ? countFiles(node.children || []) : 1), 0); }

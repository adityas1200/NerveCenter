/* eslint-disable react-refresh/only-export-components */
import { BookOpen, Check, Copy, Ticket, Workflow } from "lucide-react";
import { createContext, createElement, lazy, Suspense, useContext, useState, type ComponentPropsWithoutRef, type MouseEvent, type ReactNode } from "react";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import { Link, useInRouterContext } from "react-router-dom";
import remarkGfm from "remark-gfm";
import { headingSlug, isExternalHref, resolveLink, resolveTaskFileLink } from "@/lib/markdownLinks";
import { AGENT_NAME } from "@/components/ops/agentPanelContext";
import { cn } from "@/lib/utils";

const MermaidBlock = lazy(() => import("@/components/ops/MermaidBlock").then((module) => ({ default: module.MermaidBlock })));

type HastNode = { type: string; value?: string; children?: HastNode[] };

export interface MarkdownProps {
  children: string;
  className?: string;
  /**
   * Open a file the text links to. Without `currentPath` the link is taken as a task-folder path
   * (`./x.md`, `tasks/T-1/x.md` and `x.md` all mean `x.md`). With `currentPath` it is resolved against
   * that file's directory (`../index.md`, `folder/`, `file.md#section`) and the anchor is passed along.
   */
  onOpenFile?: (path: string, anchor?: string) => void;
  /** Path of the file being shown, relative to its folder root (a knowledge base, a skill). */
  currentPath?: string;
  /** Path of the task file being shown: its task-folder links (`onOpenFile`) and images (`resolveAsset`) resolve from its folder. */
  taskFilePath?: string;
  /** Real href for a resolved file link, so it can be opened in a new tab or copied. */
  fileHref?: (path: string, anchor?: string) => string;
  resolveAsset?: (src: string) => string;
  /**
   * Open a knowledge page the agent cited (`knowledge/runbooks/x.md`, `runbooks/x.md`). When absent,
   * citation chips link to `/knowledge?path=…`, which opens the file in the Knowledge reader.
   */
  onOpenKnowledge?: (path: string, anchor?: string) => void;
  /**
   * `chat` is the task conversation: code blocks get a header with the language and Copy, tables sit
   * in a rounded card with a tinted header row, quotes become a brand callout, headings get more air.
   */
  variant?: "default" | "chat";
}

/* ------------------------------------------------------------ drafts */

export interface MarkdownPart { draft: boolean; text: string; source?: string; updated?: string }
const DRAFT_BLOCK = /<!--\s*draft\b([^>]*?)-->[ \t]*\r?\n?([\s\S]*?)<!--\s*\/draft\s*-->/g;

/**
 * A knowledge page split at the agent's draft markers (`<!-- draft source=OPS-7 updated=… -->` …
 * `<!-- /draft -->`), so an added section can be shown as a draft until a person keeps it. Text
 * without markers is one plain part.
 */
export function splitDrafts(text: string): MarkdownPart[] {
  const value = String(text ?? "");
  if (!/<!--\s*draft\b/.test(value)) return [{ draft: false, text: value }];
  const parts: MarkdownPart[] = [];
  let last = 0;
  for (const match of value.matchAll(DRAFT_BLOCK)) {
    const start = match.index ?? 0;
    if (start > last) parts.push({ draft: false, text: value.slice(last, start) });
    const attrs = Object.fromEntries([...match[1].matchAll(/(\w+)=(\S+)/g)].map((pair) => [pair[1], pair[2]]));
    parts.push({ draft: true, text: match[2], ...(attrs.source ? { source: attrs.source } : {}), ...(attrs.updated ? { updated: attrs.updated } : {}) });
    last = start + match[0].length;
  }
  if (last < value.length) parts.push({ draft: false, text: value.slice(last) });
  return parts.filter((part) => part.draft || part.text.trim());
}

/* ------------------------------------------------------------ citations */

/** A knowledge page path as the agent writes it, with or without the `knowledge/` prefix and an optional `#section`. */
export const KNOWLEDGE_CITATION = /^(knowledge\/)?[\w./-]+\.md(#[\w-]+)?$/;
/** Ticket ids the connected sources use: NerveCenter and Jira keys, ServiceNow incidents, CDO keys. */
export const TICKET_CITATION = /^(OPS-\d+|INC\d{7}|CDO-\d+)$/;
/** A pipeline run, only when the text says "run" before the number. */
export const RUN_CITATION = /^run\s+(\d{4,})$/i;

export type Citation =
  | { kind: "knowledge"; path: string; anchor?: string; label: string; title: string; to: string }
  | { kind: "ticket"; id: string; label: string; title: string; to: string }
  | { kind: "run"; id: string; label: string; title: string; to: string };

/** What a link target or inline code token cites, or null when it is ordinary text. */
export function citationFor(text: string): Citation | null {
  const value = text.trim();
  if (!value) return null;
  const knowledge = KNOWLEDGE_CITATION.exec(value);
  if (knowledge) {
    const [pathPart, hash] = value.split("#");
    const path = pathPart.replace(/^knowledge\//, "");
    const anchor = hash ? decodeHash(hash) : undefined;
    const label = path.split("/").pop() || path;
    return { kind: "knowledge", path, anchor, label, title: anchor ? `${path}#${anchor}` : path, to: `/knowledge?path=${encodeURIComponent(path)}${anchor ? `#${encodeURIComponent(anchor)}` : ""}` };
  }
  const ticket = TICKET_CITATION.exec(value);
  if (ticket) return { kind: "ticket", id: ticket[1], label: ticket[1], title: `Ticket ${ticket[1]}`, to: `/tickets/${encodeURIComponent(ticket[1])}` };
  const run = RUN_CITATION.exec(value);
  if (run) return { kind: "run", id: run[1], label: `run ${run[1]}`, title: `Pipeline run ${run[1]}`, to: `/monitor?run=${encodeURIComponent(run[1])}` };
  return null;
}

const CITATION_ICON = { knowledge: BookOpen, ticket: Ticket, run: Workflow } as const;
const CHIP_CLASS = "inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-raised px-2 py-px align-baseline text-[12.5px] font-medium !text-ink-2 no-underline transition-colors duration-200 hover:border-line-strong hover:!text-ink-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/25";

/** True inside a fenced code block, where nothing becomes a chip. */
const InPre = createContext(false);
const CitationHandlers = createContext<{ onOpenKnowledge?: MarkdownProps["onOpenKnowledge"] }>({});

/** A small pill for a cited page, ticket or run: icon, short name, the full reference in the tooltip. */
/** An absolute link to a page of the app, as opposed to a file in a task or knowledge folder. */
export const APP_ROUTE = /^\/(?:tickets|tasks|boards|routines|monitor|data-quality|data-platform|knowledge|inbox|approvals|connectors|settings|skills|workbench|admin)(?:[/?#]|$)/;

/** In the app, a link moves within it (the panel and its conversation stay open); outside a router it is a plain link. */
function AppLink({ to, className, children }: { to: string; className?: string; children: ReactNode }) {
  const inRouter = useInRouterContext();
  return inRouter ? <Link to={to} className={className}>{children}</Link> : <a href={to} className={className}>{children}</a>;
}

export function CitationChip({ citation, label }: { citation: Citation; label?: ReactNode }) {
  const inRouter = useInRouterContext();
  const { onOpenKnowledge } = useContext(CitationHandlers);
  const Icon = CITATION_ICON[citation.kind];
  const body = <><Icon className="h-3 w-3 shrink-0 text-ink-5" aria-hidden="true" /><span className="truncate">{label ?? citation.label}</span></>;
  if (citation.kind === "knowledge" && onOpenKnowledge) {
    return <button type="button" data-citation={citation.kind} title={citation.title} className={CHIP_CLASS} onClick={() => onOpenKnowledge(citation.path, citation.anchor)}>{body}</button>;
  }
  if (inRouter) return <Link to={citation.to} data-citation={citation.kind} title={citation.title} className={CHIP_CLASS}>{body}</Link>;
  return <a href={citation.to} data-citation={citation.kind} title={citation.title} className={CHIP_CLASS}>{body}</a>;
}

// Applied directly on the element, not via a `[&_pre]:...` selector on an ancestor: the dark-theme
// stylesheet retheme's classes it finds literally on an element, so a class that only exists through
// a nested-selector variant on a parent is invisible to it and never repaints for the theme.
const PRE_CLASS = "my-2 overflow-x-auto rounded-lg border border-line bg-surface-subtle p-3";
const CODE_CLASS = "rounded bg-surface-subtle px-1 py-0.5 font-mono text-[12.5px]";
// The chat root leaves tables, code and quotes to their own element classes (a `[&_td]:` rule here would
// outrank them) and keeps only the flow: paragraphs, lists with soft markers, links, rules.
const CHAT_ROOT_CLASS = "markdown text-[14px] leading-6 text-ink-2 [&_p]:my-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_li]:pl-1 [&_li::marker]:text-ink-5 [&_strong]:font-semibold [&_strong]:text-ink-1 [&_a]:font-medium [&_a]:text-brand [&_a:hover]:text-brand-hover [&_hr]:my-5 [&_hr]:border-line [&_:not(pre)>code]:bg-surface-subtle [&_:not(pre)>code]:px-1.5 [&_:not(pre)>code]:text-[0.84em] [&_:not(pre)>code]:text-ink-1";

function PreBlock({ node, children: inner, className, ...props }: ComponentPropsWithoutRef<"pre"> & ExtraProps) {
  const child = node?.children?.[0];
  const classes = child && child.type === "element" ? String((child.properties as { className?: unknown } | undefined)?.className ?? "") : "";
  if (/language-mermaid/.test(classes) && child && child.type === "element") {
    const text = child.children.map((part) => (part.type === "text" ? part.value : "")).join("");
    return <Suspense fallback={<pre className={cn(PRE_CLASS, className)} {...props}>{inner}</pre>}><MermaidBlock code={text} /></Suspense>;
  }
  return <InPre.Provider value={true}><pre className={cn(PRE_CLASS, className)} {...props}>{inner}</pre></InPre.Provider>;
}

/** A fenced block in the chat: a header naming the language with Copy, then the code on a quiet ground. Mermaid still draws. */
function ChatPreBlock(props: ComponentPropsWithoutRef<"pre"> & ExtraProps) {
  const { node, children: inner, className, ...rest } = props;
  const [copied, setCopied] = useState(false);
  const child = node?.children?.[0];
  const classes = child && child.type === "element" ? String((child.properties as { className?: unknown } | undefined)?.className ?? "") : "";
  if (/language-mermaid/.test(classes)) return <PreBlock {...props} />;
  const language = /language-([\w+-]+)/.exec(classes)?.[1] || "text";
  const copy = () => { void navigator.clipboard?.writeText(textOf(node as HastNode | undefined).replace(/\n$/, "")).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); }); };
  return (
    <div className="my-3 overflow-hidden rounded-xl border border-line bg-raised" data-code-block>
      <div className="flex items-center justify-between border-b border-line bg-surface-panel px-3.5 py-1.5">
        <span className="font-mono text-[11.5px] lowercase text-ink-4">{language}</span>
        <button type="button" onClick={copy} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-medium text-ink-4 transition-colors hover:bg-raised hover:text-ink-1" aria-label="Copy code">{copied ? <Check className="h-3 w-3 text-emerald-600" aria-hidden="true" /> : <Copy className="h-3 w-3" aria-hidden="true" />}{copied ? "Copied" : "Copy"}</button>
      </div>
      <InPre.Provider value={true}><pre className={cn("m-0 overflow-x-auto bg-surface-panel px-4 py-3 font-mono text-[12.5px] leading-6 text-ink-2", className)} {...rest}>{inner}</pre></InPre.Provider>
    </div>
  );
}

/** Inline code that names a knowledge page, a ticket or a run becomes a chip; everything else stays code. */
function CodeToken({ node: _node, children: inner, className, ...props }: ComponentPropsWithoutRef<"code"> & ExtraProps) {
  const inPre = useContext(InPre);
  const text = typeof inner === "string" ? inner : Array.isArray(inner) && inner.every((part) => typeof part === "string") ? inner.join("") : null;
  const citation = !inPre && text ? citationFor(text) : null;
  if (citation) return <CitationChip citation={citation} />;
  // Inside a <pre>, the block above already colors the background; a second bg here would double up.
  return <code className={inPre ? cn("bg-transparent p-0", className) : cn(CODE_CLASS, className)} {...props}>{inner}</code>;
}

/**
 * Agent replies and files. Compact typography that matches the rest of the app; tables scroll instead
 * of overflowing. `mermaid` fences draw as diagrams. Headings get anchors so `#section` links scroll to
 * them. External links open in a new tab; relative links open in the viewer through `onOpenFile`.
 * Knowledge paths, ticket ids and run ids in links or inline code render as citation chips.
 */
export function Markdown({ children, className, onOpenFile, currentPath, taskFilePath, fileHref, resolveAsset, onOpenKnowledge, variant = "default" }: MarkdownProps) {
  const chat = variant === "chat";
  const slugs = new Map<string, number>();
  const anchorFor = (node: HastNode | undefined) => {
    const base = headingSlug(textOf(node));
    const seen = slugs.get(base) ?? 0; slugs.set(base, seen + 1);
    return seen ? `${base}-${seen}` : base;
  };
  // Sized/colored directly on the element for the same reason PreBlock/CodeToken are: a class that
  // only reaches this tag through a `[&_h1]:...` selector on the wrapper is invisible to the
  // dark-theme stylesheet, which only retheme's classes it finds literally on the element itself.
  const HEADING_CLASS: Record<1 | 2 | 3 | 4 | 5 | 6, string> = chat ? {
    1: "mb-2 mt-7 font-display text-[18px] font-semibold text-ink-1", 2: "mb-2 mt-7 font-display text-[16.5px] font-semibold text-ink-1", 3: "mb-1.5 mt-6 text-[15px] font-semibold text-ink-1",
    4: "mb-1 mt-4 text-[14px] font-semibold text-ink-1", 5: "mb-1 mt-4 text-[13.5px] font-semibold text-ink-2", 6: "mb-1 mt-4 text-[13.5px] font-semibold text-ink-2",
  } : {
    1: "mt-3 text-[15.5px] font-semibold text-ink-1", 2: "mt-4 text-[14.5px] font-semibold text-ink-1", 3: "mt-3 text-[14px] font-semibold text-ink-1",
    4: "mt-3 text-[14px] font-semibold text-ink-1", 5: "mt-3 text-[13.5px] font-semibold text-ink-1", 6: "mt-3 text-[13.5px] font-semibold text-ink-1",
  };
  const heading = (level: 1 | 2 | 3 | 4 | 5 | 6): Components["h1"] => function Heading({ node, children: inner, className, ...props }) {
    return createElement(`h${level}`, { ...props, className: cn(HEADING_CLASS[level], className), "data-anchor": anchorFor(node as HastNode | undefined) }, inner);
  };
  const components: Components = {
    h1: heading(1), h2: heading(2), h3: heading(3), h4: heading(4), h5: heading(5), h6: heading(6),
    strong: ({ node: _node, className, ...props }) => <strong className={cn("font-semibold text-ink-1", className)} {...props} />,
    blockquote: ({ node: _node, className, ...props }) => <blockquote className={cn("border-l-2 border-line-strong pl-3 text-ink-3", className)} {...props} />,
    hr: ({ node: _node, className, ...props }) => <hr className={cn("my-3 border-line", className)} {...props} />,
    pre: PreBlock,
    code: CodeToken,
    a: ({ href, children: inner, node, className, ...props }) => {
      const target = href || "";
      const linkClass = cn("font-medium text-brand hover:text-brand-hover", className);
      if (!target || isExternalHref(target)) {
        const web = /^(https?:|\/\/)/i.test(target);
        return <a href={href} target={web ? "_blank" : undefined} rel={web ? "noreferrer" : undefined} className={linkClass} {...props}>{inner}</a>;
      }
      if (target.startsWith("#")) {
        const anchor = decodeHash(target.slice(1));
        return <a href={target} className={linkClass} {...props} onClick={(event) => { event.preventDefault(); scrollToAnchor(event, anchor); }}>{inner}</a>;
      }
      // A page of the app (/tickets/OPS-1001, /boards/B-12, /routines/x): Sonic's tools return these links.
      if (APP_ROUTE.test(target)) return <AppLink to={target} className={linkClass}>{inner}</AppLink>;
      if (currentPath === undefined) {
        // A cited knowledge page, ticket or run. Task-folder links (`report.md` with onOpenFile) keep their behaviour
        // unless the path says `knowledge/` or the page can open knowledge itself.
        const citation = citationFor(target);
        const knowledgeWins = citation?.kind === "knowledge" && (Boolean(onOpenKnowledge) || /^knowledge\//.test(target) || !onOpenFile);
        if (citation && (citation.kind !== "knowledge" || knowledgeWins)) {
          // Keep the author's words ("the load runbook"); a path or id as the text collapses to the short name.
          const text = textOf(node as HastNode | undefined).trim();
          return <CitationChip citation={citation} label={text && text !== target && !citationFor(text) ? text : undefined} />;
        }
      }
      if (currentPath !== undefined) {
        const link = resolveLink(currentPath, target);
        if (link.kind === "anchor") return <a href={target} className={linkClass} {...props} onClick={(event) => { event.preventDefault(); scrollToAnchor(event, link.anchor); }}>{inner}</a>;
        if (link.kind === "outside") return <span className="text-ink-2" title={`${target} is outside this folder`}>{inner}</span>;
        if (link.kind === "file" && onOpenFile) {
          return <a href={fileHref ? fileHref(link.path, link.anchor) : target} className={linkClass} {...props} onClick={(event) => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return; event.preventDefault(); onOpenFile(link.path, link.anchor); }}>{inner}</a>;
        }
        return <span className="text-ink-2">{inner}</span>;
      }
      if (onOpenFile) {
        const file = taskFilePath === undefined ? normaliseRelative(target) : resolveTaskFileLink(taskFilePath, target);
        if (file === null) return <span className="text-ink-2" title={`${target} is outside this task's folder`}>{inner}</span>;
        return <button type="button" className="font-medium text-brand underline-offset-2 hover:underline" onClick={() => onOpenFile(file)}>{inner}</button>;
      }
      return <a href={href} className={linkClass} {...props}>{inner}</a>;
    },
    img: ({ src, alt, node: _node, ...props }) => {
      const source = String(src || "");
      const asset = resolveAsset && source && !/^(https?:|data:|blob:)/i.test(source) ? (taskFilePath === undefined ? normaliseRelative(source) : resolveTaskFileLink(taskFilePath, source)) : null;
      const resolved = resolveAsset && asset ? resolveAsset(asset) : source;
      return <img src={resolved} alt={alt || ""} loading="lazy" className="my-2 max-w-full rounded-lg border border-line" {...props} />;
    },
    // A wrapping div carries the horizontal scroll/clamp so the <table> itself stays a real table box:
    // overriding the table's own `display` to `block` (the old approach, via a descendant selector) strips
    // it of table layout entirely, so `table-layout: fixed` becomes a no-op on the anonymous table box the
    // browser reconstructs around the orphaned <tr>/<td> children — long cells then force the table wider
    // than the panel instead of wrapping their text to fit it.
    th: ({ node: _node, className, ...props }: ComponentPropsWithoutRef<"th"> & ExtraProps) => (
      <th className={cn("overflow-hidden border-b border-line px-2 py-1 break-words text-left align-bottom font-semibold", className)} {...props} />
    ),
    td: ({ node: _node, className, ...props }: ComponentPropsWithoutRef<"td"> & ExtraProps) => (
      <td className={cn("overflow-hidden border-b border-line px-2 py-1 break-words align-top", className)} {...props} />
    ),
    table: ({ node: _node, children, ...props }: ComponentPropsWithoutRef<"table"> & ExtraProps) => (
      <div className="my-2 max-w-full overflow-x-auto">
        <table className="w-full table-fixed text-[13px]" {...props}>{children}</table>
      </div>
    ),
  };
  if (chat) {
    Object.assign(components, {
      pre: ChatPreBlock,
      // A quote is the reply's headline callout: a soft indigo card with a brand rule, a heading inside set larger.
      blockquote: ({ node: _node, className, ...props }: ComponentPropsWithoutRef<"blockquote"> & ExtraProps) => <blockquote className={cn("my-4 rounded-r-xl border-l-[3px] border-l-brand bg-surface-panel px-5 py-3.5 text-ink-2 [&>p]:my-1.5 [&_h1]:mt-0 [&_h2]:mt-0 [&_h3]:mt-0 [&_h1]:text-[16.5px] [&_h2]:text-[16.5px] [&_h3]:text-[15.5px] [&_strong]:text-ink-1", className)} {...props} />,
      // Tables as a ruled grid inside a rounded frame: a tinted header row in sentence case, rows lit on hover.
      thead: ({ node: _node, className, ...props }: ComponentPropsWithoutRef<"thead"> & ExtraProps) => <thead className={cn("bg-surface-panel", className)} {...props} />,
      tr: ({ node: _node, className, ...props }: ComponentPropsWithoutRef<"tr"> & ExtraProps) => <tr className={cn("transition-colors hover:bg-surface-panel [&:last-child>td]:border-b-0", className)} {...props} />,
      th: ({ node: _node, className, ...props }: ComponentPropsWithoutRef<"th"> & ExtraProps) => <th className={cn("border-b border-line px-3.5 py-2 text-left align-bottom text-[12.5px] font-medium leading-5 text-ink-4", className)} {...props} />,
      td: ({ node: _node, className, ...props }: ComponentPropsWithoutRef<"td"> & ExtraProps) => <td className={cn("border-b border-line px-3.5 py-2.5 align-top text-[13.5px] leading-5 tabular-nums text-ink-1", className)} {...props} />,
      table: ({ node: _node, children, ...props }: ComponentPropsWithoutRef<"table"> & ExtraProps) => (
        <div className="my-4 max-w-full overflow-x-auto rounded-xl border border-line bg-raised">
          <table className="w-full border-collapse" {...props}>{children}</table>
        </div>
      ),
    } satisfies Components);
  }
  return (
    <div data-markdown-root="" className={chat ? cn(CHAT_ROOT_CLASS, className) : cn("markdown text-[14px] leading-6 text-ink-2 [&_h1]:mt-3 [&_h1]:text-[15.5px] [&_h1]:font-semibold [&_h1]:text-ink-1 [&_h2]:mt-4 [&_h2]:text-[14.5px] [&_h2]:font-semibold [&_h2]:text-ink-1 [&_h3]:mt-3 [&_h3]:text-[14px] [&_h3]:font-semibold [&_h3]:text-ink-1 [&_p]:my-2.5 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1.5 [&_strong]:font-semibold [&_strong]:text-ink-1 [&_a]:font-medium [&_a]:text-brand [&_a:hover]:text-brand-hover [&_code]:rounded [&_code]:bg-surface-subtle [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12.5px] [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-line [&_pre]:bg-surface-subtle [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_th]:border-b [&_th]:border-line [&_th]:overflow-hidden [&_th]:px-2 [&_th]:py-1 [&_th]:break-words [&_th]:text-left [&_th]:align-bottom [&_th]:font-semibold [&_td]:overflow-hidden [&_td]:border-b [&_td]:border-line [&_td]:px-2 [&_td]:py-1 [&_td]:break-words [&_td]:align-top [&_blockquote]:border-l-2 [&_blockquote]:border-line-strong [&_blockquote]:pl-3 [&_blockquote]:text-ink-3 [&_hr]:my-3 [&_hr]:border-line", className)}>
      <CitationHandlers.Provider value={{ onOpenKnowledge }}>
        {splitDrafts(children).map((part, index) => part.draft ? (
          <section key={index} data-draft="" aria-label="Draft section" className="my-3 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-1.5">
            <p className="!my-1 text-[12px] font-medium text-amber-800">Draft from {AGENT_NAME}{part.source ? ` · ${part.source}` : ""}{part.updated ? ` · ${part.updated}` : ""} · not reviewed yet</p>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{part.text}</ReactMarkdown>
          </section>
        ) : <ReactMarkdown key={index} remarkPlugins={[remarkGfm]} components={components}>{part.text}</ReactMarkdown>)}
      </CitationHandlers.Provider>
    </div>
  );
}

/** Scroll to a heading inside the same rendered document. */
function scrollToAnchor(event: MouseEvent<HTMLElement>, anchor: string) {
  const root = event.currentTarget.closest("[data-markdown-root]");
  if (!anchor) { root?.parentElement?.scrollTo?.({ top: 0, behavior: "smooth" }); return; }
  const heading = root?.querySelector<HTMLElement>(`[data-anchor=${JSON.stringify(headingSlug(anchor))}]`) ?? root?.querySelector<HTMLElement>(`[data-anchor=${JSON.stringify(anchor)}]`);
  heading?.scrollIntoView?.({ block: "start", behavior: "smooth" });
}

/** Find a heading by anchor inside `container` and scroll to it. Used after opening a `file.md#section` link. */
export function scrollToHeading(container: HTMLElement | null, anchor: string): boolean {
  if (!container || !anchor) return false;
  const heading = container.querySelector<HTMLElement>(`[data-anchor=${JSON.stringify(headingSlug(anchor))}]`) ?? container.querySelector<HTMLElement>(`[data-anchor=${JSON.stringify(anchor)}]`);
  heading?.scrollIntoView?.({ block: "start" });
  return Boolean(heading);
}

function textOf(node: HastNode | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.value || "";
  return (node.children || []).map(textOf).join("");
}

function decodeHash(value: string): string { try { return decodeURIComponent(value); } catch { return value; } }

/** `./x.md`, `tasks/T-1/x.md` and `x.md` all mean the file `x.md` in the task folder. */
export function normaliseRelative(href: string): string {
  return href.replace(/^\.\//, "").replace(/^tasks\/[^/]+\//, "").replace(/^\/+/, "").split("#")[0];
}

export type { ReactNode };

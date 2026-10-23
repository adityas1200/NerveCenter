import { Eye, ExternalLink, FileText, MessageSquare, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import type { ActionItem, Block } from "./blocks";
import { useTaskActions } from "./taskActions";

function isSameAppUrl(href: string): boolean {
  try { return /^https?:\/\//i.test(href) && new URL(href).origin === window.location.origin; }
  catch { return false; }
}

/**
 * What the reader can do next, at the end of a turn (SPEC-tasks-10 FR-18). `ask` sends the prompt as the
 * reader's message, so any write it leads to still goes through approval; `open` follows an app route, a
 * task file or an https link. The follow-up questions show as chips above the composer, not here.
 */
export function ActionsCard({ block, compact = false, className }: { block: Extract<Block, { kind: "actions" }>; compact?: boolean; className?: string }) {
  if (!block.items.length) return null;
  return (
    <section className={cn("min-w-0", className)} aria-label={block.title || "Next steps"}>
      {block.title ? <h3 className="mb-2 text-[12.5px] font-medium text-ink-4">{block.title}</h3> : null}
      <ul className={cn("flex flex-wrap gap-2", compact && "flex-col")}>
        {block.items.map((item, index) => <li key={`${item.label}-${index}`} className={cn(compact && "w-full")}><ActionButton item={item} primary={index === 0} compact={compact} /></li>)}
      </ul>
    </section>
  );
}

function ActionButton({ item, primary, compact }: { item: ActionItem; primary: boolean; compact: boolean }) {
  const actions = useTaskActions();
  const [sent, setSent] = useState(false);
  const classes = cn(
    "group inline-flex max-w-full items-center gap-2 rounded-lg border px-3 py-1.5 text-left text-[13.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
    primary ? "border-ink-1 bg-ink-1 text-raised hover:bg-ink-2" : "border-line bg-raised text-ink-2 hover:border-line-strong hover:text-ink-1",
    compact && "w-full",
  );
  const body = (Icon: typeof MessageSquare) => (
    <>
      <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" />
      <span className="min-w-0"><span className="block truncate">{item.label}</span>{item.detail ? <span className={cn("block truncate text-[12px] font-normal", primary ? "text-raised/70" : "text-ink-4")}>{item.detail}</span> : null}</span>
      {item.needsApproval ? <span className={cn("ml-1 inline-flex shrink-0 items-center gap-1 text-[11.5px] font-normal", primary ? "text-raised/70" : "text-ink-4")}><ShieldCheck className="h-3 w-3" aria-hidden="true" />Needs approval</span> : null}
    </>
  );
  if (item.kind === "ask") {
    const disabled = !actions.ask || !actions.canAsk || sent;
    return <button type="button" className={classes} disabled={disabled} title={sent ? "Sent" : !actions.canAsk ? actions.askBlocked : item.prompt || undefined} onClick={() => { if (!item.prompt) return; actions.ask?.(item.prompt); setSent(true); }}>{body(MessageSquare)}</button>;
  }
  const href = item.href || "";
  if (href.startsWith("/")) return <Link to={href} className={classes}>{body(Eye)}</Link>;
  if (isSameAppUrl(href)) {
    const url = new URL(href);
    return <Link to={`${url.pathname}${url.search}${url.hash}`} className={classes}>{body(Eye)}</Link>;
  }
  if (/^https:\/\//i.test(href)) return <a href={href} target="_blank" rel="noreferrer" className={classes}>{body(ExternalLink)}</a>;
  return <button type="button" className={classes} disabled={!actions.openFile} onClick={() => actions.openFile?.(href)}>{body(FileText)}</button>;
}

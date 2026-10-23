import { ArrowUp, FileText, Image as ImageIcon, Monitor, Plus, Square, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import type { AttachmentUpload } from "@/api/tasks";
import { ActivityOrb, type Activity } from "@/components/ops/ActivityOrb";
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Textarea } from "@/components/ui";
import { formatBytes } from "@/lib/frontmatter";
import { cn } from "@/lib/utils";
import { FILE_ACCEPT, IMAGE_ACCEPT, addAttachments, isImageName, toAttachmentUploads } from "./attachments";
import { MentionMenu } from "./MentionMenu";
import { canCaptureScreen, captureProblem, captureScreen } from "./screenCapture";
import { insertMention, mentionAt, mentionOptionId, mentionsIn, type Mention } from "./mentions";
import { useMentionCandidates } from "./useMentionCandidates";

/**
 * The message box. Enter sends, Shift+Enter adds a line. While the agent runs and `onStop` is given,
 * the send button becomes Stop. Used by tasks, the agent drawer and New task.
 * `layout="inline"` (the Sonic panel) is one row, the box with the button at its right, growing
 * only as text is typed; the status sits under it. `above` docks content on top of the box, inside
 * its edge: the queue of messages waiting for the current step.
 * With `mentions`, typing @ offers tickets, pipelines and tables; the picked records go to `onSend`
 * with the text (only those still written in it), so Sonic reads exactly what was pointed at.
 * With `attachments`, files come in from the + button, a drop on the box or a paste (SPEC-tasks-11) and go
 * to `onSend` as base64; a message may then be files alone.
 */
export function TaskComposer({ onSend, onStop, placeholder = "Ask a follow-up…", label, disabled = false, busy = false, activity, focusOnMount = false, hint, status, footer, size = "md", layout = "stacked", above, className, boxClassName, draft, onDraftConsumed, mentions = false, attachments = false, capture }: {
  onSend: (text: string, mentions: Mention[], attachments?: AttachmentUpload[]) => Promise<unknown> | void;
  /** When set and `busy` is true, the send button turns into Stop. */
  onStop?: () => void;
  placeholder?: string;
  /** Accessible name when the placeholder changes (New task rotates examples); defaults to the placeholder. */
  label?: string;
  disabled?: boolean;
  busy?: boolean;
  /** The kind of work behind `status`, shown as the orb's shape while busy. */
  activity?: Activity;
  focusOnMount?: boolean;
  hint?: string;
  /** Live status shown in the footer while busy, e.g. "Querying Databricks · 12s". */
  status?: ReactNode;
  /** Extra controls on the footer's left, e.g. permission and context chips. */
  footer?: ReactNode;
  size?: "md" | "lg";
  layout?: "stacked" | "inline";
  above?: ReactNode;
  className?: string;
  /** Extra classes on the box itself, e.g. a glow on the New task page. */
  boxClassName?: string;
  /** Text a page wants typed into the box (e.g. "Change the plan: "); the box takes it, focuses, then calls `onDraftConsumed`. */
  draft?: string | null;
  onDraftConsumed?: () => void;
  /** Turn on the @ menu for tickets, pipelines and tables. */
  mentions?: boolean;
  /** Turn on attaching files: the + button, drag and drop, and paste. */
  attachments?: boolean;
  /** With `attachments`, adds "Screenshot of this screen" to the + menu; returns the element to crop to, if any (SPEC-tasks-12 FR-8). */
  capture?: () => Element | null;
}) {
  const [text, setText] = useState("");
  const field = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => { if (focusOnMount) field.current?.focus(); }, [focusOnMount]);
  useEffect(() => {
    if (!draft) return;
    setText(draft);
    const element = field.current;
    if (element) { element.focus(); window.requestAnimationFrame(() => { element.setSelectionRange(draft.length, draft.length); }); }
    onDraftConsumed?.();
  }, [draft, onDraftConsumed]);
  // Grow the box to fit typed or inserted (draft) text, up to the CSS max-height cap where it scrolls
  // instead. Empty, it keeps its natural rows: a box measured before its panel had a width would
  // otherwise lock at the cap.
  useEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = "";
    if (!text) return;
    element.style.height = `${element.scrollHeight}px`;
  }, [text]);
  const [sending, setSending] = useState(false);
  // The @ menu: where the @word being typed starts, what follows it, and the records picked so far.
  const [caret, setCaret] = useState(0);
  const [picked, setPicked] = useState<Mention[]>([]);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const typing = mentions && !disabled ? mentionAt(text, caret) : null;
  const menuOpen = Boolean(typing) && typing?.start !== dismissedAt;
  const candidates = useMentionCandidates(menuOpen && typing ? typing.term : null);
  const menuId = useId();
  useEffect(() => { setActive(0); }, [typing?.term, typing?.start]);
  const pick = (mention: Mention) => {
    if (!typing) return;
    const next = insertMention(text, typing.start, caret, mention.label);
    setText(next.text); setCaret(next.caret);
    setPicked((list) => [...list.filter((item) => !(item.kind === mention.kind && item.id === mention.id)), mention]);
    const element = field.current;
    if (element) window.requestAnimationFrame(() => { element.focus(); element.setSelectionRange(next.caret, next.caret); });
  };
  // Files waiting to go with the next message, and why any were left out.
  const [files, setFiles] = useState<File[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const imagePicker = useRef<HTMLInputElement | null>(null);
  const filePicker = useRef<HTMLInputElement | null>(null);
  const canAttach = attachments && !disabled;
  const previews = useMemo(() => files.map((file) => (isImageName(file.name) && typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : null)), [files]);
  useEffect(() => () => { for (const url of previews) if (url) URL.revokeObjectURL(url); }, [previews]);
  const attach = (incoming: File[]) => { if (!canAttach || !incoming.length) return; const result = addAttachments(files, incoming); setFiles(result.files); setProblems(result.problems); };
  const screenshot = async () => {
    try { attach([await captureScreen({ element: capture?.() ?? null })]); } catch (error) { setProblems([captureProblem(error)]); }
  };
  const detach = (index: number) => { setFiles((list) => list.filter((_, at) => at !== index)); setProblems([]); };
  const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");
  const dropHandlers = canAttach ? {
    onDragOver: (event: DragEvent<HTMLDivElement>) => { if (!hasFiles(event)) return; event.preventDefault(); setDragging(true); },
    onDragLeave: (event: DragEvent<HTMLDivElement>) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); },
    onDrop: (event: DragEvent<HTMLDivElement>) => { if (!hasFiles(event)) return; event.preventDefault(); setDragging(false); attach(Array.from(event.dataTransfer.files)); },
  } : {};
  // A pasted screenshot is a file; pasted text (even with a file beside it, as some apps copy) still pastes as text.
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = Array.from(event.clipboardData?.files ?? []); if (!canAttach || !pasted.length) return;
    if (!event.clipboardData.getData("text/plain")) event.preventDefault();
    attach(pasted);
  };
  const submit = async () => {
    const value = text.trim(); if ((!value && !files.length) || disabled || sending) return;
    setSending(true);
    // Files go as a third argument only when there are some, so a text-only send is called as before.
    try { const named = mentionsIn(value, picked); await (files.length ? onSend(value, named, await toAttachmentUploads(files)) : onSend(value, named)); setText(""); setPicked([]); setDismissedAt(null); setFiles([]); setProblems([]); } finally { setSending(false); }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (menuOpen && typing) {
      const count = candidates.items.length;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setDismissedAt(typing.start); return; }
      if (count && event.key === "ArrowDown") { event.preventDefault(); setActive((index) => (index + 1) % count); return; }
      if (count && event.key === "ArrowUp") { event.preventDefault(); setActive((index) => (index - 1 + count) % count); return; }
      if (count && (event.key === "Enter" || event.key === "Tab") && !event.shiftKey) { event.preventDefault(); pick(candidates.items[Math.min(active, count - 1)]); return; }
    }
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); }
  };
  const track = (element: HTMLTextAreaElement) => setCaret(element.selectionStart ?? element.value.length);
  const showStop = busy && Boolean(onStop);
  // Idle shows nothing (the send affordance is the button itself, not a caption); busy still says what is happening.
  const message = hint ?? (busy ? (status ?? (onStop ? "Thinking" : "Sonic reads it after the current step")) : "");
  const button = showStop ? (
    <Button size="icon" className="h-8 w-8 shrink-0 rounded-full bg-ink-1 text-raised hover:bg-ink-2" aria-label="Stop Sonic" title="Stop Sonic" onClick={onStop}><Square className="h-3 w-3 fill-current" aria-hidden="true" /></Button>
  ) : (
    <Button size="icon" variant="primary" className="h-8 w-8 shrink-0 rounded-full" aria-label="Send" title="Send (Enter)" disabled={disabled || sending || (!text.trim() && !files.length)} onClick={() => void submit()}><ArrowUp className="h-4 w-4" aria-hidden="true" /></Button>
  );
  const attachButton = attachments ? (
    <>
      {/* The + opens a choice first, as chat apps do; each choice opens the file dialog on its own types only. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 rounded-full text-ink-3 hover:text-ink-1 data-[state=open]:bg-surface-subtle data-[state=open]:text-ink-1" aria-label="Attach files" title="Attach images, PDFs, Office files, transcripts or text files" disabled={!canAttach || sending}><Plus className="h-4 w-4" aria-hidden="true" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-64">
          <AttachChoice icon={ImageIcon} label="Images" hint="PNG, JPG, GIF, WebP" onSelect={() => imagePicker.current?.click()} />
          <AttachChoice icon={FileText} label="Files" hint="PDF, Word, Excel, PowerPoint, transcripts (.vtt), CSV, text, markdown" onSelect={() => filePicker.current?.click()} />
          {capture && canCaptureScreen() ? <AttachChoice icon={Monitor} label="Screenshot of this screen" hint="Your browser asks which tab to share; one picture is taken" onSelect={() => void screenshot()} /> : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <input ref={imagePicker} type="file" multiple accept={IMAGE_ACCEPT} className="hidden" tabIndex={-1} aria-hidden="true" data-testid="image-input" onChange={(event) => { attach(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
      <input ref={filePicker} type="file" multiple accept={FILE_ACCEPT} className="hidden" tabIndex={-1} aria-hidden="true" data-testid="attachment-input" onChange={(event) => { attach(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
    </>
  ) : null;
  const attached = files.length || problems.length ? (
    <div className={cn("space-y-1.5", layout === "inline" ? "px-3 pt-2.5" : "px-3.5 pt-3")}>
      {files.length ? (
        <ul aria-label="Attached files" className="flex flex-wrap gap-2">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`} className="flex max-w-[240px] items-center gap-2 rounded-xl border border-line bg-surface-subtle py-1 pl-1 pr-1.5">
              {previews[index] ? <img src={previews[index] ?? undefined} alt="" className="h-8 w-8 shrink-0 rounded-lg object-cover" /> : <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-raised text-ink-4" aria-hidden="true"><FileText className="h-4 w-4" /></span>}
              <span className="min-w-0 leading-4"><span className="block truncate text-[12.5px] font-medium text-ink-1" title={file.name}>{file.name}</span><span className="block text-[11px] text-ink-5">{formatBytes(file.size)}</span></span>
              <button type="button" className="shrink-0 rounded-full p-1 text-ink-4 hover:bg-raised hover:text-ink-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40" aria-label={`Remove ${file.name}`} disabled={sending} onClick={() => detach(index)}><X className="h-3.5 w-3.5" aria-hidden="true" /></button>
            </li>
          ))}
        </ul>
      ) : null}
      {problems.length ? <div role="alert" className="space-y-0.5 text-[12.5px] text-rose-700">{problems.map((problem) => <p key={problem}>{problem}</p>)}</div> : null}
    </div>
  ) : null;
  const dropCue = dragging ? <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-brand/60 bg-brand-soft/90 text-[13.5px] font-medium text-brand">Drop files to attach</div> : null;
  const statusLine = message ? (
    <span className={cn("flex min-w-0 items-center gap-2 truncate text-[12.5px]", busy ? "text-ink-3" : "text-ink-5")}>
      {busy ? <ActivityOrb activity={activity} /> : null}
      <span className="truncate">{message}</span>
    </span>
  ) : null;
  const box = "overflow-hidden rounded-2xl border border-line bg-raised shadow-[0_1px_2px_rgb(9_9_11/0.04),0_4px_16px_-8px_rgb(9_9_11/0.10)] transition-[border-color,box-shadow] focus-within:border-line-strong focus-within:shadow-[0_1px_2px_rgb(9_9_11/0.05),0_8px_24px_-10px_rgb(9_9_11/0.16)]";
  const input = <Textarea ref={field} aria-label={label ?? placeholder} value={text} onChange={(event) => { setText(event.target.value); track(event.target); }} onSelect={(event) => track(event.currentTarget)} onKeyDown={onKeyDown} onPaste={onPaste} aria-controls={menuOpen ? menuId : undefined} aria-activedescendant={menuOpen && candidates.items[active] ? mentionOptionId(candidates.items[active]) : undefined} placeholder={placeholder} disabled={disabled} rows={size === "lg" ? 3 : 1} className={cn("min-h-0 max-h-48 resize-none overflow-y-auto border-0 bg-transparent leading-6 shadow-none placeholder:text-ink-5 focus-visible:ring-0", layout === "inline" ? "px-0 py-1 text-[15px]" : size === "lg" ? "px-4 py-3.5 text-[15px]" : "px-4 py-3 text-[15px]")} />;

  const menu = menuOpen && typing ? <MentionMenu id={menuId} items={candidates.items} active={active} loading={candidates.loading} term={typing.term} onPick={pick} onHover={setActive} /> : null;

  if (layout === "inline") {
    return (
      <div className={cn("relative", className)} data-auto-refresh-block={Boolean(text.trim() || files.length || sending)}>
        {menu}
        <div className={cn(box, "relative", boxClassName)} {...dropHandlers}>
          {dropCue}
          {above}
          {attached}
          <div className={cn("flex items-end gap-2 py-2 pr-2", attachments ? "pl-1.5" : "pl-4")}>
            {attachButton}
            <div className="min-w-0 flex-1">{input}</div>
            {button}
          </div>
        </div>
        {statusLine || footer ? <div className="mt-1.5 flex min-w-0 items-center gap-2 px-1.5">{footer}{statusLine}</div> : null}
      </div>
    );
  }
  return (
    <div className={cn("relative", className)} data-auto-refresh-block={Boolean(text.trim() || files.length || sending)}>
      {menu}
      <div className={cn(box, "relative", boxClassName)} {...dropHandlers}>
        {dropCue}
        {above}
        {attached}
        {input}
        <div className="flex items-center justify-between gap-3 px-3 pb-2.5">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {attachButton}
            {footer}
            {statusLine}
          </div>
          {button}
        </div>
      </div>
    </div>
  );
}

/** One line of the + menu: what it attaches and which types it takes. */
function AttachChoice({ icon: Icon, label, hint, onSelect }: { icon: typeof FileText; label: string; hint: string; onSelect: () => void }) {
  return (
    <DropdownMenuItem onSelect={onSelect} className="items-start gap-3 py-2">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand"><Icon className="h-4 w-4" aria-hidden="true" /></span>
      <span className="min-w-0"><span className="block text-[13.5px] font-medium text-ink-1">{label}</span><span className="block text-[12px] leading-4 text-ink-5">{hint}</span></span>
    </DropdownMenuItem>
  );
}

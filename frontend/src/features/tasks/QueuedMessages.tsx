import { refreshAfterWrite } from "@/lib/refreshAfterWrite";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { tasksApi, type QueuedMessage, taskKeys } from "@/api/tasks";
import { AGENT_NAME } from "@/components/ops/agentPanelContext";
import { Button, Textarea, Tooltip, TooltipContent, TooltipTrigger, useToast } from "@/components/ui";
import { cn } from "@/lib/utils";
import { useAction } from "@/lib/useAction";

/**
 * Messages typed while the agent works, docked on top of the message box the way coding agents show
 * their queue: one numbered line per message in the order Sonic will read them, under a single
 * "Queued · n" header that says when they will be read. Hovering a line (or focusing it) shows its
 * actions: Send now interrupts the current step and delivers it first, Edit changes it in place,
 * Remove drops it. A long message shows one line until clicked. The stack empties as Sonic reads.
 */
export function QueuedMessages({ taskId, queue, className }: { taskId: string; queue: QueuedMessage[]; className?: string }) {
  if (!queue.length) return null;
  return (
    <section aria-label="Queued messages" className={cn("queue-enter border-b border-line bg-surface-panel px-2 pb-1.5 pt-2", className)}>
      <div className="flex items-baseline justify-between gap-3 px-2 pb-1">
        <span className="text-[12px] font-semibold text-ink-3">Queued · {queue.length}</span>
        <span className="truncate text-[11.5px] text-ink-5">{AGENT_NAME} reads {queue.length === 1 ? "it" : "them"} after the current step</span>
      </div>
      <ol className="max-h-[188px] space-y-px overflow-y-auto">
        {queue.map((message, index) => <QueuedRow key={message.id} taskId={taskId} message={message} position={index + 1} />)}
      </ol>
    </section>
  );
}

function QueuedRow({ taskId, message, position }: { taskId: string; message: QueuedMessage; position: number }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState(message.text);
  const field = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => { if (!editing) setText(message.text); }, [message.text, editing]);
  useEffect(() => { if (editing) { const element = field.current; element?.focus(); element?.setSelectionRange(element.value.length, element.value.length); } }, [editing]);
  const refresh = () => refreshAfterWrite(queryClient, { queryKey: taskKeys.all });

  const edit = useMutation({
    mutationFn: (value: string) => tasksApi.editQueued(taskId, message.id, value),
    onSuccess: async () => { setEditing(false); await refresh(); },
    onError: (error) => toast.error("Message not changed", error instanceof Error ? error.message : "Try again."),
  });
  const remove = useAction({
    mutationFn: () => tasksApi.removeQueued(taskId, message.id),
    invalidate: [taskKeys.all],
    error: "Message not removed",
  });
  const sendNow = useMutation({
    mutationFn: () => tasksApi.sendQueuedNow(taskId, message.id),
    onSuccess: async (result) => { await refresh(); if (result.interrupted) toast.info("Sent now", `${AGENT_NAME} stopped the current step to read it.`); },
    onError: (error) => toast.error("Message not sent", error instanceof Error ? error.message : "Try again."),
  });
  const busy = edit.isPending || remove.isPending || sendNow.isPending;

  const save = () => { const value = text.trim(); if (!value) return; if (value === message.text) { setEditing(false); return; } edit.mutate(value); };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); save(); }
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setEditing(false); }
  };

  const number = <span aria-hidden="true" className="mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full border border-line bg-raised text-[11px] font-semibold tabular-nums text-ink-4">{position}</span>;

  if (editing) {
    return (
      <li className="flex items-start gap-2 rounded-lg bg-raised px-2 py-1.5 shadow-[0_0_0_1px_rgb(var(--c-line-strong))]" data-queued={message.id}>
        {number}
        <div className="min-w-0 flex-1">
          <Textarea ref={field} aria-label={`Edit queued message ${position}`} value={text} onChange={(event) => setText(event.target.value)} onKeyDown={onKeyDown} rows={2} className="min-h-0 resize-none border-0 bg-transparent px-0 py-0 text-[13.5px] leading-5 shadow-none focus-visible:ring-0" />
          <div className="flex items-center justify-end gap-1.5 pt-1">
            <Button size="xs" variant="ghost" onClick={() => setEditing(false)} disabled={busy}>Cancel</Button>
            <Button size="xs" variant="primary" onClick={save} disabled={busy || !text.trim()}>{edit.isPending ? "Saving" : "Save"}</Button>
          </div>
        </div>
      </li>
    );
  }

  const icon = "h-6 w-6 rounded-md text-ink-4 hover:bg-ink-1/[0.06] hover:text-ink-1";
  return (
    <li className={cn("group/queued flex items-start gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-raised focus-within:bg-raised", busy && "opacity-60")} data-queued={message.id}>
      {number}
      <button type="button" onClick={() => setExpanded((value) => !value)} className={cn("min-w-0 flex-1 text-left text-[13.5px] leading-5 text-ink-2", expanded ? "whitespace-pre-wrap break-words" : "truncate")} title={expanded ? undefined : message.text} aria-expanded={expanded}>
        {message.text}
      </button>
      <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/queued:opacity-100 group-focus-within/queued:opacity-100 [@media(hover:none)]:opacity-100">
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className="h-6 rounded-md px-2 text-[12px] font-semibold text-brand hover:bg-brand/10 disabled:opacity-50" onClick={() => sendNow.mutate()} disabled={busy}>Send now</button>
          </TooltipTrigger>
          <TooltipContent>Stops the current step and sends this first</TooltipContent>
        </Tooltip>
        <Button size="icon" variant="ghost" className={icon} aria-label="Edit" title="Edit" onClick={() => setEditing(true)} disabled={busy}><Pencil className="h-3.5 w-3.5" /></Button>
        <Button size="icon" variant="ghost" className={cn(icon, "hover:text-rose-600")} aria-label="Remove" title="Remove" onClick={() => remove.mutate()} disabled={busy}><X className="h-3.5 w-3.5" /></Button>
      </span>
    </li>
  );
}

import { Check, Send } from "lucide-react";
import { useState } from "react";
import { AGENT_NAME } from "@/components/ops/agentPanelContext";
import { Button, CopyButton, Input, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";
import { AgentCard } from "./AgentCard";
import type { Block } from "./blocks";
import { StateTag } from "./DataBlocks";
import { sendEmailPrompt, useTaskActions } from "./taskActions";

type Email = Extract<Block, { kind: "email" }>;
const addresses = (value: string) => value.split(/[,;\s]+/).map((item) => item.trim()).filter(Boolean);

/**
 * A draft email the reader can edit before anything is sent (SPEC-tasks-10 FR-19). Send asks Sonic, in the
 * reader's words, to send the edited text; a sent email is read-only.
 */
export function EmailCard({ block, compact = false, className }: { block: Email; compact?: boolean; className?: string }) {
  const actions = useTaskActions();
  const [to, setTo] = useState(block.to.join(", "));
  const [cc, setCc] = useState(block.cc.join(", "));
  const [subject, setSubject] = useState(block.subject);
  const [body, setBody] = useState(block.body);
  const [asked, setAsked] = useState(false);
  const sent = block.status === "sent";
  const edited = { to: addresses(to), cc: addresses(cc), subject: subject.trim(), body: body.trim() };
  const ready = edited.to.length > 0 && Boolean(edited.subject) && Boolean(edited.body);
  const canSend = Boolean(actions.ask) && actions.canAsk && ready && !asked;
  const label = (text: string) => <span className="w-14 shrink-0 pt-1.5 text-[12.5px] text-ink-4">{text}</span>;
  if (sent) {
    return (
      <AgentCard title={block.subject || "Email"} action={<StateTag tone="good">Sent</StateTag>} compact={compact} className={className}>
        <p className="text-[12.5px] text-ink-4">To {block.to.join(", ")}{block.cc.length ? ` · Cc ${block.cc.join(", ")}` : ""}</p>
        <p className="mt-2 whitespace-pre-wrap text-[13.5px] leading-6 text-ink-2">{block.body}</p>
      </AgentCard>
    );
  }
  return (
    <AgentCard title="Email draft" note={block.note} action={<StateTag tone="neutral">Draft</StateTag>} compact={compact} className={className}>
      <div className="space-y-2">
        <label className="flex items-start gap-2">{label("To")}<Input aria-label="To" value={to} onChange={(event) => setTo(event.target.value)} disabled={asked} className="h-8 text-[13px]" /></label>
        <label className="flex items-start gap-2">{label("Cc")}<Input aria-label="Cc" value={cc} onChange={(event) => setCc(event.target.value)} disabled={asked} placeholder="None" className="h-8 text-[13px]" /></label>
        <label className="flex items-start gap-2">{label("Subject")}<Input aria-label="Subject" value={subject} onChange={(event) => setSubject(event.target.value)} disabled={asked} className="h-8 text-[13px] font-medium" /></label>
        <Textarea aria-label="Body" value={body} onChange={(event) => setBody(event.target.value)} disabled={asked} rows={compact ? 6 : 9} className="text-[13.5px] leading-6" />
      </div>
      <div className={cn("mt-3 flex flex-wrap items-center gap-2")}>
        {asked
          ? <span className="flex items-center gap-1.5 text-[13px] text-ink-3"><Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />Asked {AGENT_NAME} to send it. You approve the send.</span>
          : <Button size="sm" variant="primary" disabled={!canSend} title={!actions.canAsk ? actions.askBlocked : !ready ? "Add a recipient, a subject and a body" : undefined} onClick={() => { actions.ask?.(sendEmailPrompt(edited)); setAsked(true); }}><Send className="h-3.5 w-3.5" />Send</Button>}
        <CopyButton value={`Subject: ${edited.subject}\n\n${edited.body}`} label="Copy" showLabel size="sm" className="h-8" />
        {!asked ? <span className="ml-auto text-[12px] text-ink-5">Nothing is sent until you approve it</span> : null}
      </div>
    </AgentCard>
  );
}

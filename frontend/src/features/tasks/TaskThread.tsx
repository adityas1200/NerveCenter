/* eslint-disable react-refresh/only-export-components */
import { Braces, ChevronRight, Database, FileText, Globe, ListChecks, Minus, Pencil, Play, Search, ShieldCheck, Puzzle, Terminal, Wrench, X, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { tasksApi, type Task, type TaskAttachment, type TaskEvent } from "@/api/tasks";
import { ActivityOrb, type Activity } from "@/components/ops/ActivityOrb";
import { AGENT_NAME } from "@/components/ops/agentPanelContext";
import { ErrorNotice } from "@/components/ops/ErrorNotice";
import { Markdown } from "@/components/ops/Markdown";
import { Button, CopyButton, Skeleton, Textarea, formatDuration, formatRelativeTime } from "@/components/ui";
import { formatBytes } from "@/lib/frontmatter";
import { cn } from "@/lib/utils";
import { AgentCard } from "./cards/AgentCard";
import { ArtifactFrame } from "./cards/ArtifactFrame";
import { ComponentView } from "./cards/BlockCard";
import { componentFrom, isComponentTool } from "./cards/blocks";
import { proposalsFrom } from "./cards/fixes";
import { artifactFrom, planFrom, queryCardFrom, type Card } from "./cards/cards";
import { ApprovalPrompt } from "./cards/ExplainedApproval";
import { InvestigationCard } from "./cards/InvestigationCard";
import { PlanCard } from "./cards/PlanCard";
import { QueryCard } from "./cards/QueryCard";
import { TaskActionsContext, useTaskActions, type TaskActions } from "./cards/taskActions";
import { isImageName } from "./attachments";
import { investigationFrom } from "./investigation";
import { QuestionPrompt, QuestionSettledCard } from "./QuestionPrompt";
import { NERVECENTER_PREFIX, activityOf, liveLabel, stepLabel, systemName, toolTitle } from "./stepLabels";
import { firstEvent, groupEvents, lastEvent, safeParse, type ThreadGroup } from "./taskEvents";
import { TeachCard } from "./TeachCard";
import { teachMomentsFrom } from "./teachMoments";
import { availableSkillsLabel } from "./taskUsage";
import { HELPER_SKILLS, commandGist, skillRef, skillSlug, toolMeta, type StepKind } from "./tools";
import { splitHeadline } from "./turnHeadline";
import type { StartingTool, TaskDraft } from "./useTaskStream";
import { useAction } from "@/lib/useAction";

/**
 * The task as one conversation (SPEC-tasks-10). The reader's messages sit right in a grey bubble. Each
 * agent turn opens with one grey line, "Worked for 2m 32s · 11 steps · Databricks", that folds away
 * everything it did on the way (its steps and running commentary) and opens on click; then, once the turn
 * is done, the reply's first sentence as its headline; then the components it drew, in order, then the
 * rest of the reply as rich text, then "15.5s · 2 turns". A turn that starts a skill gets
 * a centred phase divider naming it. Components, plans, findings, questions and approvals stay in view.
 */

export function TaskThread({ task, events, pendingApproval, pendingQuestion = null, compact = false, onOpenFile, onOpenTask, draft = null, startingTool = null, liveStatus = false, onAdjustPlan, editable = false, onStop, onAsk, askBlocked }: {
  task: Task; events: TaskEvent[]; pendingApproval: TaskEvent | null;
  /** The `question.asked` event the task is waiting on, if any. */
  pendingQuestion?: TaskEvent | null;
  compact?: boolean; onOpenFile?: (path: string) => void;
  /** Called when a frame's "Open task" link is followed (the side panel closes itself). */
  onOpenTask?: () => void;
  /** The reply being written right now (live only). */
  draft?: TaskDraft | null;
  /** A tool the agent has decided to call whose event has not landed yet. */
  startingTool?: StartingTool | null;
  /** Show what the agent is doing now ("Working for 10s", the step about to start) in the thread. Off where the composer below already shows it. */
  liveStatus?: boolean;
  /** The plan card's "Adjust plan": the page prefills its composer with the draft. */
  onAdjustPlan?: (draft: string) => void;
  /** Whether the reader may edit a sent message in place, which rewinds the task to it. Off for viewers. */
  editable?: boolean;
  onStop?: () => void;
  /** Sends a message as the reader, for the components' actions. Without it, actions that ask are off. */
  onAsk?: (text: string) => void;
  /** Why asking is off right now (live, waiting, stopped, viewer); undefined when the reader may ask. */
  askBlocked?: string;
}) {
  const live = task.status === "running" || task.status === "queued";
  const actions = useMemo<TaskActions>(() => ({ ask: onAsk, canAsk: Boolean(onAsk) && !askBlocked, askBlocked, openFile: onOpenFile, taskId: task.id }), [onAsk, askBlocked, onOpenFile, task.id]);
  const groups = useMemo(() => groupEvents(events, live), [events, live]);
  const plan = useMemo(() => planFrom(events, live), [events, live]);
  const streaming = Boolean(draft && draft.text);
  // The running turn's clock starts at the reader's last message, or at the task's start when a ticket began it.
  const turnStart = useMemo(() => [...events].reverse().find((event) => event.type === "user.message")?.at ?? task.startedAt ?? null, [events, task.startedAt]);
  const turns = useMemo(() => turnsFrom(groups), [groups]);
  const proposals = useMemo(() => proposalsFrom(events), [events]);

  // Everything in view outside the fold: cards the agent drew, its plan, questions, errors, status lines.
  const renderVisible = (group: ThreadGroup): ReactNode => {
    const seq = firstEvent(group)?.seq;
    const key = "events" in group ? `${group.kind}-${group.events[0]?.id}` : group.event.id;
    let body: ReactNode = null;
    if (group.kind === "component") {
      const component = componentFrom(group.event, group.result);
      // An apply_fix waiting on its approval is drawn by the approval card; its own card arrives with the result.
      const waiting = component?.type === "block" && component.block.kind === "fix_result" && component.block.pending && Boolean(pendingApproval);
      body = component && !waiting && !(component.type === "block" && component.block.kind === "actions" && !component.block.items.length) ? <ComponentView component={component} compact={compact} taskId={task.id} /> : null;
    }
    else if (group.kind === "findings") body = <InvestigationCard investigation={investigationFrom(group.events)} live={live} compact={compact} onOpenFile={onOpenFile} />;
    else if (group.kind === "approval") {
      const pending = pendingApproval?.id === group.event.id;
      const decided = group.decided ? { decision: group.decided.decision === "denied" ? "denied" as const : "approved" as const, by: group.decided.actor?.name || null } : pending ? null : { decision: "none" as const, by: null };
      body = <div data-prompt={pending || undefined}><ApprovalPrompt event={group.event} explanation={group.explanation} proposal={group.event.fix ? proposals.get(group.event.fix.proposalId) ?? null : null} decided={decided} compact={compact} /></div>;
    }
    else if (group.kind === "artifact") { const artifact = artifactFrom(group.event); body = artifact ? <ArtifactFrame artifact={artifact} taskId={task.id} compact onExpand={onOpenFile} onOpenTask={onOpenTask} /> : null; }
    else if (group.kind === "plan") body = plan && plan.eventId === group.event.id ? <PlanCard plan={plan} live={live} compact={compact} onAdjust={live ? onAdjustPlan : undefined} onStop={onStop} /> : <p className="text-[13px] text-ink-5">Plan replaced</p>;
    else if (group.kind === "question") body = <QuestionBlock event={group.event} answered={group.answered} pending={pendingQuestion?.id === group.event.id} compact={compact} />;
    else if (group.kind === "error") body = <ErrorNotice compact what={group.event.title} why={firstLine(group.event.detail) || undefined} next={task.status !== "cancelled" ? "Send a message to continue" : undefined} detail={group.event.detail} />;
    else if (group.kind === "status") body = <p className="text-[12.5px] text-ink-5">{group.event.title}{group.event.detail ? ` · ${group.event.detail}` : ""}</p>;
    else if (group.kind === "assistant") body = <AssistantBlock text={group.event.text || ""} compact={compact} onOpenFile={onOpenFile} />;
    else if (group.kind === "result") body = <TurnFooter event={group.event} />;
    return body ? <div key={key} data-seq={seq} className="animate-fade-in">{body}</div> : null;
  };

  const lastTurn = turns[turns.length - 1];
  const liveTurnMissing = (live || Boolean(pendingApproval)) && lastTurn?.kind !== "agent";
  // An approval Sonic did not explain still needs the reader: it is drawn at the end of the turn, outside the fold (FR-7).
  const looseApproval = pendingApproval && !groups.some((group) => group.kind === "approval" && group.event.id === pendingApproval.id) ? pendingApproval : null;
  // apply_fix has no card to draw until its approval and result; the approval card stands in for it.
  const drawing = live && startingTool && isComponentTool(startingTool.name) && !/(^|__)apply_fix$/.test(startingTool.name) ? startingTool : null;
  const renderAgent = (turn: Extract<Turn, { kind: "agent" }> | null, isLive: boolean, isLast: boolean) => {
    const parts = turn ? splitTurn(turn.groups) : { fold: [], visible: [], reply: null, result: null };
    // FR-6: a finished turn that drew something opens with its answer, so the reader need not scroll past the cards.
    const replyText = parts.reply?.kind === "assistant" ? parts.reply.event.text || "" : "";
    const drew = parts.visible.some((group) => group.kind === "component" || group.kind === "findings" || group.kind === "approval");
    const split = !isLive && drew && replyText ? splitHeadline(replyText) : null;
    return (
      <section key={turn?.key ?? "live-turn"} className={cn("group/turn space-y-4", compact && "space-y-3")} aria-label={`${AGENT_NAME}'s turn`}>
        {parts.fold.length || isLive ? <WorkedFold groups={parts.fold} live={isLive} liveStatus={liveStatus} since={turnStart} result={parts.result} startingTool={isLive && !drawing && liveStatus ? startingTool : null} pendingApproval={pendingApproval} compact={compact} onOpenFile={onOpenFile} /> : null}
        {split ? <div data-seq={firstEvent(parts.reply!)?.seq} className="animate-fade-in"><TurnHeadline text={split.headline} compact={compact} onOpenFile={onOpenFile} /></div> : null}
        {parts.visible.filter((group) => !isNextSteps(group)).map(renderVisible)}
        {isLast && looseApproval ? <div key={looseApproval.id} data-seq={looseApproval.seq} data-prompt className="animate-fade-in"><ApprovalPrompt event={looseApproval} proposal={looseApproval.fix ? proposals.get(looseApproval.fix.proposalId) ?? null : null} compact={compact} /></div> : null}
        {isLive && drawing ? <ComponentSkeleton key="drawing" name={drawing.name} compact={compact} /> : null}
        {parts.reply && !split ? renderVisible(parts.reply) : null}
        {split?.rest ? <div data-seq={firstEvent(parts.reply!)?.seq} className="animate-fade-in"><LongReply text={split.rest} compact={compact} onOpenFile={onOpenFile} /></div> : null}
        {/* What a person taught Sonic in this turn, saved for review (SPEC-knowledge-05 FR-5). */}
        {teachMomentsFrom(parts.fold).map((moment) => <div key={moment.id} className="animate-fade-in"><TeachCard moment={moment} compact={compact} /></div>)}
        {/* Next steps close the turn, after the reply that explains them. */}
        {parts.visible.filter(isNextSteps).map(renderVisible)}
        {isLive && streaming && draft ? <div data-seq="draft" className="animate-fade-in"><AssistantBlock text={draft.text} compact={compact} onOpenFile={onOpenFile} streaming /></div> : null}
        {parts.result && parts.result.kind === "result" ? <div key={parts.result.event.id} data-seq={parts.result.event.seq} className="!mt-2 animate-fade-in"><TurnFooter event={parts.result.event} reply={parts.reply?.kind === "assistant" ? parts.reply.event.text : null} /></div> : null}
      </section>
    );
  };

  return (
    <TaskActionsContext.Provider value={actions}>
    <div className={cn("space-y-7", compact && "space-y-4")}>
      {turns.map((turn, index) => {
        const next = turns[index + 1];
        // The phase a skill opens is marked once, above the message that asked for it (or the turn itself when nothing asked).
        const phase = turn.kind === "user" ? (next?.kind === "agent" ? next.skill : null) : turns[index - 1]?.kind === "user" ? null : turn.skill;
        return (
          <div key={turn.kind === "user" ? turn.group.event.id : turn.key} className={cn("space-y-7", compact && "space-y-4")}>
            {phase && !compact ? <PhaseDivider label={phase} /> : null}
            {turn.kind === "user"
              ? <div data-seq={turn.group.event.seq} className="animate-fade-in"><UserBubble event={turn.group.event} compact={compact} taskId={task.id} editable={editable && task.status !== "cancelled"} /></div>
              : renderAgent(turn, live && index === turns.length - 1, index === turns.length - 1)}
          </div>
        );
      })}
      {liveTurnMissing ? renderAgent(null, live, true) : null}
      {task.status === "queued" && !events.length ? <p className="text-[13.5px] text-ink-4">Queued</p> : null}
    </div>
    </TaskActionsContext.Provider>
  );
}

const isNextSteps = (group: ThreadGroup) => group.kind === "component" && group.event.name === `${NERVECENTER_PREFIX}show_actions`;

const COMPONENT_WORD: Record<string, string> = { show_chart: "chart", show_heatmap: "heatmap", show_gauges: "gauges", show_funnel: "funnel", show_gantt: "timeline", show_table: "table", show_status_grid: "status grid", show_view: "view", show_flow: "flow", show_checklist: "checklist", show_email: "email draft", show_timeline: "timeline", show_lineage: "lineage", show_ticket: "ticket", show_pipeline_runs: "runs", propose_fix: "fix preview" };

/** The card Sonic is drawing, before its call lands (FR-10). */
function ComponentSkeleton({ name, compact }: { name: string; compact: boolean }) {
  const word = COMPONENT_WORD[name.replace(/^.*__/, "")] || null;
  return (
    <AgentCard title={word ? `Drawing a ${word}` : "Drawing"} compact={compact} className="animate-fade-in">
      <div className="space-y-2" aria-hidden="true"><Skeleton className="h-4 w-1/2" /><Skeleton className="h-16 w-full" /></div>
    </AgentCard>
  );
}

type Turn = { kind: "user"; group: Extract<ThreadGroup, { kind: "user" }> } | { kind: "agent"; key: string; groups: ThreadGroup[]; /** The skill the turn loaded, for the phase divider. */ skill: string | null };

/** The thread as turns: each message the reader sent, then everything the agent did until the next one. */
function turnsFrom(groups: ThreadGroup[]): Turn[] {
  const turns: Turn[] = [];
  for (const group of groups) {
    // The session starting on its own is not worth a line in the conversation.
    if (group.kind === "steps" && group.events.every((event) => event.type === "session.init")) continue;
    if (group.kind === "user") { turns.push({ kind: "user", group }); continue; }
    const first = firstEvent(group);
    let last = turns[turns.length - 1];
    if (last?.kind !== "agent") { last = { kind: "agent", key: `turn-${first?.id}`, groups: [], skill: null }; turns.push(last); }
    last.groups.push(group);
    if (group.kind === "steps" && !last.skill) {
      // The phase is the first skill that does the work; writing and routing helpers never name one.
      const name = group.events.filter((event) => event.type === "tool.use" && event.name === "Skill")
        .map((event) => skillRef(safeParse(event.input)).replace(/^[\w-]+:/, ""))
        .find((slug) => slug && !HELPER_SKILLS.has(slug));
      if (name) last.skill = name.replace(/[-_]+/g, " ");
    }
  }
  return turns;
}

/**
 * A turn in three parts. The fold holds the way there: every run of steps and the commentary between
 * them. The reply is the agent's last word, when nothing ran after it. Everything else stays in view.
 */
function splitTurn(groups: ThreadGroup[]): { fold: ThreadGroup[]; visible: ThreadGroup[]; reply: ThreadGroup | null; result: ThreadGroup | null } {
  let lastSteps = -1; let lastReply = -1;
  groups.forEach((group, index) => { if (group.kind === "steps") lastSteps = index; if (group.kind === "assistant" && group.event.text?.trim()) lastReply = index; });
  const replyIndex = lastReply > lastSteps ? lastReply : -1;
  const fold: ThreadGroup[] = []; const visible: ThreadGroup[] = []; let result: ThreadGroup | null = null;
  groups.forEach((group, index) => {
    if (index === replyIndex) return;
    if (group.kind === "result") result = group;
    else if (group.kind === "steps" || group.kind === "assistant") fold.push(group);
    else visible.push(group);
  });
  return { fold, visible, reply: replyIndex >= 0 ? groups[replyIndex] : null, result };
}

/** A centred label between two hairlines, naming the phase a skill opened: "DATA PULL". */
function PhaseDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3" role="separator" aria-label={label}>
      <span className="h-px flex-1 bg-line" aria-hidden="true" />
      <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-5">{label}</span>
      <span className="h-px flex-1 bg-line" aria-hidden="true" />
    </div>
  );
}

/**
 * "› ∿ Worked for 2m 32s · 11 steps · 1 sub-agent ✓", then the flow of the work as connected chips
 * (Skill → NerveCenter ×2 → Read ×2 → Run ×4 → Write ×2): the chip at work pulses, a chip with a failed
 * call turns red, and clicking one opens the fold on its rows. The fold (always open while it runs or
 * waits on the reader) is a rail with each run of steps as rows and the agent's commentary between them.
 */
function WorkedFold({ groups, live, liveStatus, since, result, startingTool, pendingApproval, compact, onOpenFile }: { groups: ThreadGroup[]; live: boolean; liveStatus: boolean; since: string | null; result: ThreadGroup | null; startingTool: StartingTool | null; pendingApproval: TaskEvent | null; compact: boolean; onOpenFile?: (path: string) => void }) {
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const root = useRef<HTMLDivElement | null>(null);
  const elapsed = useElapsed(since, live);
  const steps = useMemo(() => groups.flatMap((group) => (group.kind === "steps" ? stepsFrom(group.events, group.live, pendingApproval).filter((step) => step.kind !== "init") : [])), [groups, pendingApproval]);
  const nodes = useMemo(() => flowOf(steps), [steps]);
  const subAgents = steps.filter((step) => step.label.startsWith("Delegated")).length;
  const stepCount = steps.length - subAgents;
  // A pending approval is drawn in the turn itself, so waiting no longer opens the fold (FR-7).
  const show = open || live;
  const systems = [...new Set(steps.map((step) => step.system).filter((name): name is string => Boolean(name)))];
  const first = groups[0]; const last = groups[groups.length - 1];
  const firstAt = first ? firstEvent(first)?.at : null;
  const lastAt = last ? lastEvent(last)?.at : null;
  const resultMs = result && result.kind === "result" ? result.event.durationMs || 0 : 0;
  const spanMs = resultMs || (firstAt && lastAt ? Date.parse(lastAt) - Date.parse(firstAt) : 0);
  const took = live ? (elapsed !== null ? elapsedLabel(elapsed) : null) : Number.isFinite(spanMs) && spanMs >= 1000 ? formatDuration(spanMs) : null;
  const facts = [stepCount ? `${stepCount} ${stepCount === 1 ? "step" : "steps"}` : null, subAgents ? `${subAgents} sub-agent${subAgents === 1 ? "" : "s"}` : null, systems.length ? systems.slice(0, 3).join(", ") + (systems.length > 3 ? ` +${systems.length - 3}` : "") : null].filter(Boolean);
  // A chip opens the fold and brings its first row into view, lit for a moment.
  useEffect(() => {
    if (!focus) return;
    const row = root.current?.querySelector<HTMLElement>(`[data-flow="${CSS.escape(focus)}"]`);
    row?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    const timer = window.setTimeout(() => setFocus(null), 1800);
    return () => window.clearTimeout(timer);
  }, [focus]);
  const shown = nodes.slice(0, MAX_FLOW);
  return (
    <div ref={root}>
      <button type="button" className="group/worked flex w-full items-center gap-2 text-left text-[13px]" onClick={() => setOpen((value) => !value)} aria-expanded={show}>
        <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-ink-5 transition-transform", show && "rotate-90")} aria-hidden="true" />
        {live && !liveStatus
          // The composer below says what is happening and for how long; the fold only names the steps.
          ? <span className="min-w-0 truncate font-medium text-ink-3 transition-colors group-hover/worked:text-ink-1">{facts.length ? facts.join(" · ") : "Steps"}</span>
          : <>
            <span className={cn("shrink-0 font-medium transition-colors group-hover/worked:text-ink-1", live ? "text-ink-1" : "text-ink-3")}>{live ? "Working" : "Worked"}{took ? <span className="tabular-nums">{` for ${took}`}</span> : null}</span>
            {facts.length ? <span className="min-w-0 truncate text-[12.5px] text-ink-5">· {facts.join(" · ")}</span> : null}
          </>}
        <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-2 text-[12px] text-ink-5 opacity-0 transition-opacity group-hover/worked:opacity-100" aria-hidden="true">{show ? "Hide steps" : "Show steps"}</span>
        {live && liveStatus ? <span className="flex shrink-0 items-center"><ActivityOrb activity="tool" label="In progress" /></span> : null}
      </button>
      {show && shown.length ? (
        <ol className="ml-[22px] mt-2.5 flex flex-wrap items-center gap-y-1.5" aria-label="Flow of work">
          {shown.map((node, index) => {
            const Icon = STEP_ICON[node.kind];
            return (
              <li key={node.key + index} className="flex animate-fade-in items-center">
                {index ? <ChevronRight className="mx-0.5 h-3 w-3 text-ink-5" aria-hidden="true" /> : null}
                <button type="button" onClick={() => { setOpen(true); setFocus(node.key); }} title={`${node.label}${node.count > 1 ? ` · ${node.count} calls` : ""}${node.failed ? ` · ${node.failed} failed` : ""}. Show these steps`}
                  className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-all hover:-translate-y-px hover:shadow-[0_2px_6px_rgba(15,23,42,0.08)]",
                    node.state === "live" ? "border-brand/40 bg-brand-soft text-brand ring-2 ring-brand/15" : node.state === "waiting" ? "border-amber-300 bg-amber-50 text-amber-800" : node.failed ? "border-rose-200 bg-rose-50/70 text-rose-700" : "border-line bg-raised text-ink-3 hover:border-line-strong hover:text-ink-1")}>
                  {node.state === "live" ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" aria-hidden="true" /> : <Icon className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden="true" />}
                  <span className="max-w-[140px] truncate">{node.label}</span>
                  {node.count > 1 ? <span className="rounded-full bg-black/5 px-1.5 text-[10.5px] tabular-nums">{node.count}</span> : null}
                </button>
              </li>
            );
          })}
          {nodes.length > MAX_FLOW ? <li className="flex items-center"><ChevronRight className="mx-0.5 h-3 w-3 text-ink-5" aria-hidden="true" /><button type="button" onClick={() => setOpen(true)} className="rounded-full border border-dashed border-line px-2.5 py-1 text-[12px] font-medium text-ink-4 hover:text-ink-1">+{nodes.length - MAX_FLOW} more</button></li> : null}
        </ol>
      ) : null}
      {show && (groups.length || (live && startingTool)) ? (
        <div className={cn("ml-[7px] mt-3 space-y-2.5 border-l border-line pl-4", compact && "pl-3")}>
          {groups.map((group) => group.kind === "steps"
            ? <StepRows key={`steps-${group.events[0]?.id}`} events={group.events} live={group.live} startingTool={group.live ? startingTool : null} pendingApproval={pendingApproval} focus={focus} />
            : group.kind === "assistant" ? <div key={group.event.id} data-seq={group.event.seq} className="animate-fade-in"><Markdown variant="chat" onOpenFile={onOpenFile} className="text-[13.5px] leading-6 text-ink-3 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">{group.event.text || ""}</Markdown></div> : null)}
          {live && startingTool && !groups.some((group) => group.kind === "steps" && group.live) ? <p className="flex items-center gap-2.5 text-[13px] text-ink-3"><ActivityOrb activity={activityOf(startingTool.name)} label="In progress" />{liveLabel(toolTitle(startingTool.name, startingTool.title))}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

const MAX_FLOW = 9;
interface FlowNode { key: string; kind: StepKind; label: string; count: number; failed: number; state: StepState }

/** Which chip a step belongs to: its kind, and for skills and systems which one. */
function flowKey(step: Pick<Step, "kind" | "system" | "target">): string {
  if (step.kind === "system") return `system:${step.system}`;
  if (step.kind === "skill") return `skill:${step.target}`;
  return step.kind;
}

const FLOW_LABEL: Partial<Record<StepKind, string>> = { ran: "Run", read: "Read", edit: "Write", search: "Search", web: "Web", plan: "Plan", approval: "Approval" };

/** Consecutive steps of one kind as one chip, in the order the work happened. */
function flowOf(steps: Step[]): FlowNode[] {
  const nodes: FlowNode[] = [];
  for (const step of steps) {
    const key = flowKey(step);
    const last = nodes[nodes.length - 1];
    const node = last && last.key === key ? last : null;
    const state: StepState = step.state;
    if (node) {
      node.count += 1;
      if (state === "failed") node.failed += 1;
      if (state === "live" || state === "waiting") node.state = state;
      continue;
    }
    const label = step.kind === "skill" ? step.target || "Skill" : step.kind === "system" ? step.system || "System" : FLOW_LABEL[step.kind] || step.verb.split(" ").slice(0, 2).join(" ");
    nodes.push({ key, kind: step.kind, label, count: 1, failed: state === "failed" ? 1 : 0, state: state === "live" || state === "waiting" ? state : "done" });
  }
  return nodes;
}

/**
 * A message the reader sent. Edit (on hover) turns the bubble into a box, the way a chat lets you
 * rewrite a turn: Send rewinds the task to this message and Sonic answers the new text; everything
 * after it is discarded. The backend refuses when Sonic already made a change after the message.
 */
function UserBubble({ event, compact, taskId, editable }: { event: TaskEvent; compact: boolean; taskId: string; editable: boolean }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(event.text || "");
  const field = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => { if (editing) { const element = field.current; if (element) { element.focus(); element.setSelectionRange(element.value.length, element.value.length); } } }, [editing]);
  const edit = useAction({
    mutationFn: (value: string) => tasksApi.editMessage(taskId, event.id, value),
    onSuccess: () => setEditing(false),
    error: "Message not changed",
  });
  const cancel = () => { setEditing(false); setText(event.text || ""); };
  const save = () => { const value = text.trim(); if (!value || edit.isPending) return; if (value === (event.text || "").trim()) { cancel(); return; } edit.mutate(value); };
  const onKeyDown = (keyEvent: KeyboardEvent<HTMLTextAreaElement>) => {
    if (keyEvent.key === "Enter" && !keyEvent.shiftKey) { keyEvent.preventDefault(); save(); }
    else if (keyEvent.key === "Escape") { keyEvent.preventDefault(); cancel(); }
  };
  if (editing) {
    return (
      <div className="flex flex-col items-end">
        <div className={cn("w-full max-w-[85%] rounded-2xl border border-line-strong bg-surface-subtle", compact && "max-w-[92%]")}>
          <Textarea ref={field} aria-label="Edit your message" value={text} onChange={(change) => setText(change.target.value)} onKeyDown={onKeyDown} rows={Math.min(8, Math.max(2, text.split("\n").length))} disabled={edit.isPending} className="min-h-0 resize-none border-0 bg-transparent px-4 py-2.5 text-[14px] leading-6 shadow-none focus-visible:ring-0" />
          <div className="flex items-center justify-end gap-2 px-3 pb-2.5">
            <Button size="sm" variant="ghost" onClick={cancel} disabled={edit.isPending} busy={edit.isPending}>Cancel</Button>
            <Button size="sm" variant="primary" onClick={save} disabled={edit.isPending || !text.trim()}>{edit.isPending ? "Sending" : "Send"}</Button>
          </div>
        </div>
        <span className="mt-1 text-[11.5px] text-ink-5">Sending replaces everything after this message.</span>
      </div>
    );
  }
  // A quiet grey bubble on the right and nothing else; who sent it and when (and Edit) show on hover.
  return (
    <div className="group flex flex-col items-end">
      {event.attachments?.length ? <MessageAttachments attachments={event.attachments} taskId={taskId} compact={compact} /> : null}
      <div className={cn("max-w-[80%] whitespace-pre-wrap rounded-[20px] rounded-br-md bg-surface-subtle px-4 py-2.5 text-[15px] leading-6 text-ink-1", compact && "max-w-[92%] px-3.5 py-2 text-[14px]")}>{event.text}</div>
      <span className="mt-1 flex h-4 items-center gap-1.5 text-[11.5px] text-ink-5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        {editable && event.text ? <><button type="button" className="inline-flex items-center gap-1 font-medium hover:text-ink-1" onClick={() => { setText(event.text || ""); setEditing(true); }} aria-label="Edit this message"><Pencil className="h-3 w-3" aria-hidden="true" />Edit</button><span aria-hidden="true">·</span></> : null}
        <span>{event.actor?.name ? `${event.actor.name} · ` : ""}{formatRelativeTime(event.at)}</span>
      </span>
    </div>
  );
}

/**
 * The files a person attached to a message, above its bubble (SPEC-tasks-11 FR-10): images as thumbnails,
 * other files as chips. They open in the file viewer where the thread has one, else in a new tab.
 */
function MessageAttachments({ attachments, taskId, compact }: { attachments: TaskAttachment[]; taskId: string; compact: boolean }) {
  const { openFile } = useTaskActions();
  return (
    <ul aria-label="Attached files" className={cn("mb-1.5 flex max-w-[80%] flex-wrap justify-end gap-1.5", compact && "max-w-[92%]")}>
      {attachments.map((file) => {
        const url = tasksApi.fileUrl(taskId, file.path);
        const image = isImageName(file.name);
        const body = image
          ? <img src={url} alt={file.name} loading="lazy" className={cn("rounded-xl border border-line object-cover", compact ? "h-16 w-16" : "h-24 w-24")} />
          : <span className="flex max-w-[220px] items-center gap-2 rounded-xl border border-line bg-raised px-2.5 py-1.5"><FileText className="h-4 w-4 shrink-0 text-ink-4" aria-hidden="true" /><span className="min-w-0 leading-4"><span className="block truncate text-[12.5px] font-medium text-ink-1">{file.name}</span><span className="block text-[11px] text-ink-5">{formatBytes(file.size)}</span></span></span>;
        const label = `Open ${file.name}`;
        return (
          <li key={file.path}>
            {openFile
              ? <button type="button" className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40" aria-label={label} title={file.name} onClick={() => openFile(file.path)}>{body}</button>
              : <a href={url} target="_blank" rel="noreferrer" className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40" aria-label={label} title={file.name}>{body}</a>}
          </li>
        );
      })}
    </ul>
  );
}

/** The turn's answer in one sentence, above what it drew (FR-6). Inline markdown (bold, code) is kept. */
function TurnHeadline({ text, compact, onOpenFile }: { text: string; compact: boolean; onOpenFile?: (path: string) => void }) {
  return (
    <div role="heading" aria-level={3} className="min-w-0" data-headline>
      <Markdown variant="chat" onOpenFile={onOpenFile} className={cn("text-[17px] font-semibold leading-7 tracking-[-0.01em] text-ink-1 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_strong]:font-semibold", compact && "text-[15px] leading-6")}>{text}</Markdown>
    </div>
  );
}

/**
 * The rest of a reply under components it already drew (FR-6). The cards carry the evidence, so a long
 * tail opens on its first lines and the rest is one click away rather than a wall under the cards.
 */
function LongReply({ text, compact, onOpenFile }: { text: string; compact: boolean; onOpenFile?: (path: string) => void }) {
  const [open, setOpen] = useState(false);
  const long = text.length > LONG_REPLY;
  return (
    <div>
      <div className={cn(long && !open && "max-h-[156px] overflow-hidden [mask-image:linear-gradient(to_bottom,black_55%,transparent)]")}>
        <AssistantBlock text={text} compact={compact} onOpenFile={onOpenFile} />
      </div>
      {long ? <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="mt-1 text-[13px] font-medium text-ink-4 hover:text-ink-1">{open ? "Show less" : "Show the full reply"}</button> : null}
    </div>
  );
}
const LONG_REPLY = 700;

/** The agent's reply: rich markdown (callouts, grid tables, code with Copy) at full width, no avatar or box. */
function AssistantBlock({ text, compact, onOpenFile, streaming = false }: { text: string; compact: boolean; onOpenFile?: (path: string) => void; streaming?: boolean }) {
  return (
    <div className="min-w-0" aria-live={streaming ? "polite" : undefined} data-streaming={streaming || undefined}>
      <Markdown variant="chat" onOpenFile={onOpenFile} className={cn("text-[15px] leading-[26px] text-ink-1 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", compact && "text-[14px] leading-[22px]")}>{text}</Markdown>
      {streaming ? <span className="mt-0.5 inline-block h-[1em] w-[2px] animate-pulse rounded-full bg-brand align-text-bottom" aria-hidden="true" data-caret /> : null}
    </div>
  );
}

/**
 * Under the reply, one quiet line: Copy, then "15.5s · 2 turns". A finished turn needs no badge; a
 * failed one says so in red. Copy shows on hover of the turn, the way a chat keeps its tools out of the way.
 */
function TurnFooter({ event, reply }: { event: TaskEvent; reply?: string | null }) {
  const durationMs = event.durationMs || 0;
  const turns = event.turns || 0;
  const parts = [durationMs >= 1000 ? formatDuration(durationMs) : null, turns > 1 ? `${turns} turns` : null].filter(Boolean);
  return (
    <div className="-ml-1.5 flex h-7 items-center gap-1 text-[12px] text-ink-5">
      {reply ? <CopyButton value={reply} label="Copy reply" size="icon" className="h-7 w-7 rounded-md text-ink-5 opacity-60 transition-opacity hover:bg-surface-subtle hover:text-ink-1 group-hover/turn:opacity-100 focus-visible:opacity-100" /> : null}
      {event.isError ? <span className="inline-flex items-center gap-1.5 pl-1.5 font-medium text-rose-700"><span className="h-1.5 w-1.5 rounded-full bg-rose-500" aria-hidden="true" />Failed</span> : null}
      {parts.length ? <span className={cn("tabular-nums", event.isError ? "before:mr-1.5 before:content-['·']" : "pl-1")}>{parts.join(" · ")}</span> : null}
    </div>
  );
}

/**
 * A question the agent asked, where it asked it. Pending: the form. Answered: one quiet line with the
 * answers. Neither answered nor pending (skipped, or the task was stopped): says so.
 */
function QuestionBlock({ event, answered, pending, compact }: { event: TaskEvent; answered: TaskEvent | null; pending: boolean; compact: boolean }) {
  const questions = event.questions || [];
  const first = questions[0]?.question || event.title || "a question";
  return (
    <div className="flex">
      <div className="min-w-0 flex-1">
        {pending && event.inboxId ? (
          <div data-prompt><QuestionPrompt inboxId={event.inboxId} questions={questions} form={Boolean(event.form)} title={event.form ? event.title : null} reason={event.form ? event.reason : null} compact={compact} /></div>
        ) : (
          <>
            <p className="text-[14px] leading-6 text-ink-2">{event.form ? `${AGENT_NAME} asked for: ${event.title || "a few details"}` : questions.length > 1 ? `${AGENT_NAME} asked ${questions.length} questions, starting with "${first}"` : `${AGENT_NAME} asked: ${first}`}</p>
            <QuestionSettledCard questions={questions} settled={answered ? { status: "answered", answers: answered.answers || {}, by: answered.actor?.name || null } : { status: "denied" }} compact={compact} className="mt-1.5" />
          </>
        )}
        <span className="mt-1 block text-[11.5px] text-ink-5">{AGENT_NAME} · {formatRelativeTime(event.at)}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ steps */

type StepState = "done" | "live" | "failed" | "blocked" | "waiting";
/** One tool call as a row: `verb` in plain words, `target` the command, pattern or file it acted on. */
interface Step { id: string; kind: StepKind; system?: string | null; verb: string; target?: string | null; isFile?: boolean; label: string; detail?: string | null; state: StepState; at: string; raw?: string; activity?: Activity; link?: { to: string; label: string } | null; chip?: string | null; /** A `query_data` call: opening the row shows the query and what came back. */ query?: Card | null }

const KNOWLEDGE_TOOL = "mcp__nervecenter__update_knowledge";
/** The lesson-capture step keeps the agent's reason as its detail, and once saved links to the draft. */
function knowledgeStep(step: Step, use: TaskEvent | undefined, result: TaskEvent) {
  if (use?.name !== KNOWLEDGE_TOOL || result.isError) return;
  const output = safeParse(result.content);
  if (output?.saved && typeof output.link === "string") { step.link = { to: output.link, label: "Open" }; step.chip = "draft"; }
}

function describe(event: TaskEvent): Pick<Step, "kind" | "system" | "verb" | "target" | "isFile"> {
  const name = event.name || "";
  const input = safeParse(event.input);
  const text = (key: string) => (typeof input?.[key] === "string" ? String(input[key]) : null);
  const meta = toolMeta(name);
  if (meta?.family === "skill") return { kind: "skill", verb: "Skill", target: skillSlug(input) || null };
  // A command reads as what it does; the raw line (paths, cd prefixes) is noise in the fold.
  if (meta?.family === "shell") { const gist = commandGist(input); return gist.description ? { kind: "ran", verb: gist.description } : { kind: "ran", verb: "Run", target: gist.command || null }; }
  if (meta?.row) {
    const { kind, verb, keys, isFile, firstLine: first } = meta.row;
    const target = keys.map(text).find(Boolean) ?? null;
    return { kind, verb, target: first ? firstLine(target) : target, isFile };
  }
  const label = stepLabel(event);
  if (meta?.family === "plan" || name === `${NERVECENTER_PREFIX}update_plan`) return { kind: "plan", verb: label };
  const system = systemName(name);
  if (system) return { kind: "system", system, verb: label };
  return { kind: "other", verb: label };
}

function stepsFrom(events: TaskEvent[], live: boolean, pendingApproval: TaskEvent | null): Step[] {
  const steps: Step[] = [];
  const byToolUse = new Map<string, Step>();
  const uses = new Map<string, TaskEvent>();
  for (const event of events) {
    if (event.type === "session.init") { const detail = [event.plugins?.length ? `${event.plugins.join(", ")} plugin` : null, availableSkillsLabel(event), event.mcpServers?.length ? event.mcpServers.map((server) => server.name).join(", ") : null].filter(Boolean).join(" · ") || null; steps.push({ id: event.id, kind: "init", verb: `${AGENT_NAME} started`, target: detail, label: `${AGENT_NAME} started`, state: "done", at: event.at }); }
    else if (event.type === "tool.use") {
      const reason = event.name === KNOWLEDGE_TOOL ? safeParse(event.input)?.placementReason : null;
      const step: Step = { id: event.id, ...describe(event), label: stepLabel(event), detail: typeof reason === "string" ? reason : null, state: "live", at: event.at, raw: event.input, activity: activityOf(event.name), query: queryCardFrom(event) };
      steps.push(step); if (event.toolUseId) { byToolUse.set(event.toolUseId, step); uses.set(event.toolUseId, event); }
    }
    else if (event.type === "tool.result") { const step = event.toolUseId ? byToolUse.get(event.toolUseId) : undefined; const use = event.toolUseId ? uses.get(event.toolUseId) : undefined; if (step) { step.state = event.isError ? "failed" : "done"; step.detail = event.isError ? firstLine(event.content) : step.detail ?? null; knowledgeStep(step, use, event); if (use) step.query = queryCardFrom(use, event) ?? step.query; } }
    else if (event.type === "approval.requested") { const label = event.title || "Waiting for approval"; steps.push({ id: event.id, kind: "approval", verb: label, label, detail: event.detail || null, state: pendingApproval?.id === event.id ? "waiting" : "done", at: event.at, raw: event.tool?.input }); }
    else if (event.type === "approval.decided") { const label = event.title || "Decided"; steps.push({ id: event.id, kind: "approval", verb: label, label, state: event.decision === "denied" ? "blocked" : "done", at: event.at }); }
    else if (event.type === "approval.denied") { const label = event.title || "Blocked"; steps.push({ id: event.id, kind: "approval", verb: label, label, detail: event.detail || null, state: "blocked", at: event.at, raw: event.tool?.input }); }
  }
  if (!live) for (const step of steps) if (step.state === "live") step.state = "done";
  return steps;
}

const firstLine = (value?: string | null) => (value || "").split(/\r?\n/).find((line) => line.trim()) || null;

/** The tool call still open, if any: the last `tool.use` without its `tool.result`. */
function openToolCall(events: TaskEvent[]): TaskEvent | undefined {
  const open = new Map<string, TaskEvent>();
  for (const event of events) {
    if (event.type === "tool.use" && event.toolUseId) open.set(event.toolUseId, event);
    else if (event.type === "tool.result" && event.toolUseId) open.delete(event.toolUseId);
  }
  return [...open.values()].pop();
}

/** What the agent is doing right now, for the composer's status line: the open tool call, else the tool it is about to call. */
export function currentActivity(events: TaskEvent[], startingTool: StartingTool | null = null): string {
  const pending = openToolCall(events);
  if (pending) return liveLabel(stepLabel(pending));
  if (startingTool) return liveLabel(toolTitle(startingTool.name, startingTool.title));
  const last = events[events.length - 1];
  if (last?.type === "user.message") return "Reading your message";
  // Between steps the model is deciding what to do next.
  return "Thinking";
}

/** The kind of work behind `currentActivity`, for the composer's orb. */
export function currentActivityKind(events: TaskEvent[], startingTool: StartingTool | null = null): Activity {
  const pending = openToolCall(events);
  if (pending) return activityOf(pending.name);
  if (startingTool) return activityOf(startingTool.name);
  return events[events.length - 1]?.type === "user.message" ? "idle" : "tool";
}

/**
 * One run of the agent's steps as rows inside the Worked fold: a small icon, the verb and what it acted
 * on. A row with input opens to show it; a step waiting on the reader carries its approval. The session
 * starting is not a step anyone needs to read, so it is left out.
 */
function StepRows({ events, live, startingTool, pendingApproval, focus = null }: { events: TaskEvent[]; live: boolean; startingTool: StartingTool | null; pendingApproval: TaskEvent | null; /** The flow chip the reader picked: its rows light up. */ focus?: string | null }) {
  const steps = useMemo(() => stepsFrom(events, live, pendingApproval).filter((step) => step.kind !== "init"), [events, live, pendingApproval]);
  const [showRaw, setShowRaw] = useState<string | null>(null);
  const current = live ? [...steps].reverse().find((step) => step.state === "live") : undefined;
  if (!steps.length && !(live && startingTool)) return null;
  return (
    <ol>
      {steps.map((step) => {
        const rawOpen = showRaw === step.id && Boolean(step.raw);
        return (
          <li key={step.id} className="animate-fade-in text-[13px]" data-state={step.state} data-flow={flowKey(step)}>
            <div className={cn("group/row -mx-1.5 flex items-center gap-2.5 rounded-md px-1.5 py-[3px] transition-colors", focus === flowKey(step) ? "bg-brand-soft" : step.raw && "hover:bg-surface-subtle")}>
              <StepIcon step={step} />
              <button type="button" className={cn("flex min-w-0 flex-1 items-center gap-2 text-left", !step.raw && "cursor-default")} onClick={step.raw ? () => setShowRaw(rawOpen ? null : step.id) : undefined} aria-expanded={step.raw ? rawOpen : undefined} title={step.raw ? `${step.label}. Click to ${rawOpen ? "hide" : "show"} the input` : step.label}>
                <span className={cn(step.target ? "shrink-0" : "min-w-0 truncate", step.state === "waiting" ? "font-medium text-ink-1" : "text-ink-3")}>{step.verb}</span>
                {step.target ? step.isFile ? <FileChip path={step.target} /> : <span className={cn("min-w-0 truncate text-ink-4", step.kind === "ran" && "font-mono text-[12px]")}>{step.target}</span> : null}
                {step.raw ? <span className={cn("ml-auto flex shrink-0 items-center gap-1 text-[11px] font-medium text-ink-5 transition-opacity", rawOpen ? "opacity-100" : "opacity-0 group-hover/row:opacity-100")} aria-hidden="true"><Braces className="h-3 w-3" />{rawOpen ? "Hide input" : "Input"}</span> : null}
              </button>
              {step.chip ? <span className="shrink-0 rounded-full bg-amber-50 px-1.5 py-px text-[11px] font-medium text-amber-800 ring-1 ring-amber-200">{step.chip}</span> : null}
              {step.link ? <Link to={step.link.to} className="shrink-0 text-[12px] font-medium text-brand hover:text-brand-hover">{step.link.label}</Link> : null}
            </div>
            {step.detail ? <p className={cn("ml-6 truncate text-[12.5px]", step.state === "failed" ? "text-rose-600" : "text-ink-5")} title={step.detail}>{step.detail}</p> : null}
            {rawOpen && step.query?.kind === "query" ? <QueryCard card={step.query} compact className="mb-1 ml-6 mt-1" /> : rawOpen ? <pre className="mb-1 ml-6 mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-surface-subtle p-2.5 font-mono text-[11.5px] text-ink-3">{step.raw}</pre> : null}
          </li>
        );
      })}
      {live && !current && startingTool ? <li className="flex items-center gap-2.5 py-[3px] text-[13px]"><ActivityOrb activity={activityOf(startingTool.name)} label="In progress" /><span className="min-w-0 flex-1 truncate text-ink-3">{liveLabel(toolTitle(startingTool.name, startingTool.title))}</span></li> : null}
    </ol>
  );
}

const STEP_ICON: Record<StepKind, LucideIcon> = { init: Play, ran: Terminal, read: FileText, edit: Pencil, search: Search, web: Globe, skill: Puzzle, plan: ListChecks, system: Database, approval: ShieldCheck, other: Wrench };

/** The mark before a row: the kind of work, or its state when that matters more (running, waiting on you, failed). */
function StepIcon({ step }: { step: Step }) {
  if (step.state === "live") return <ActivityOrb activity={step.activity} label="In progress" />;
  if (step.state === "waiting") return <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center" aria-label="Waiting for you"><span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" /></span>;
  if (step.state === "failed") return <X className="h-3.5 w-3.5 shrink-0 text-rose-600" aria-label="Failed" />;
  if (step.state === "blocked") return <Minus className="h-3.5 w-3.5 shrink-0 text-ink-5" aria-label="Blocked" />;
  const Icon = STEP_ICON[step.kind];
  return <Icon className="h-3.5 w-3.5 shrink-0 text-ink-5" aria-label="Done" />;
}

/** A file a step touched, as a small chip: the name, with the full path on hover. */
function FileChip({ path }: { path: string }) {
  const name = path.split(/[\\/]/).filter(Boolean).pop() || path;
  return <span className="inline-flex min-w-0 items-center gap-1 rounded-md bg-surface-subtle px-1.5 py-px text-[12.5px] text-ink-3" title={path}><FileText className="h-3 w-3 shrink-0 text-ink-5" aria-hidden="true" /><span className="truncate">{name}</span></span>;
}

/** Milliseconds since `since`, ticking every second while `running`. */
function useElapsed(since: string | null | undefined, running: boolean): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running || !since) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [since, running]);
  const start = since ? Date.parse(since) : Number.NaN;
  return Number.isFinite(start) ? Math.max(0, now - start) : null;
}

/** Whole seconds under a minute ("42s"), then the usual short form ("4m 12s", "2h 05m"). */
const elapsedLabel = (ms: number) => (ms < 60_000 ? `${Math.floor(ms / 1000)}s` : formatDuration(ms));

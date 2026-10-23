import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { tasksApi, type Task, type TaskDelta, type TaskEvent, taskKeys } from "@/api/tasks";

/** The reply as it is being written. `settled` once its block closed and the stored event is expected. */
export interface TaskDraft { text: string; settled: boolean }
/** A tool the agent decided to call whose stored `tool.use` event has not arrived yet. */
export interface StartingTool { name: string; title: string; at: string }

const STARTING_TOOL_TTL = 10_000;
const RECONNECT_MIN_MS = 2_000;
const RECONNECT_MAX_MS = 30_000;

/**
 * One task, kept live. Loads the task with its stored events, then holds one SSE stream open for new
 * events, status changes and partial output. Nothing polls: the server pushes, and a dropped stream
 * reconnects with backoff. Only this chat is kept live; other screens keep their manual refresh
 * (SPEC-platform-manual-refresh).
 */
export function useTaskStream(taskId: string | undefined) {
  const queryClient = useQueryClient();
  const initial = useQuery({ queryKey: taskKeys.detail(taskId || ""), queryFn: ({ signal }) => tasksApi.get(taskId || "", signal), enabled: Boolean(taskId), refetchOnWindowFocus: false, retry: false });
  const [live, setLive] = useState<{ task: Task | null; events: TaskEvent[] }>({ task: null, events: [] });
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  const [startingTool, setStartingTool] = useState<StartingTool | null>(null);
  const [connected, setConnected] = useState(false);
  const lastSeq = useRef(0);
  const toolTimer = useRef<number | null>(null);
  // The task's history version as this reader knows it. When the server reports a different one (a sent
  // message was edited and the conversation rewound), the events are dropped and the stream reopened from 0.
  const version = useRef<number | null>(null);
  const [generation, setGeneration] = useState(0);
  const loaded = Boolean(initial.data);

  useEffect(() => { setLive({ task: null, events: [] }); setDraft(null); setStartingTool(null); lastSeq.current = 0; version.current = null; }, [taskId]);
  useEffect(() => {
    if (!initial.data) return;
    const { events, ...task } = initial.data;
    if (version.current === null) version.current = task.historyVersion || 0;
    // Set before the stream opens so it asks only for events after the saved snapshot.
    lastSeq.current = Math.max(lastSeq.current, ...(events ?? []).map((event) => event.seq), 0);
    setLive((current) => {
      const merged = new Map<number, TaskEvent>();
      for (const event of [...(events ?? []), ...current.events]) merged.set(event.seq, event);
      const list = [...merged.values()].sort((a, b) => a.seq - b.seq);
      return { task: current.task && current.task.updatedAt > task.updatedAt ? current.task : (task as Task), events: list };
    });
  }, [initial.data]);

  // Opened once per task (and per history rewind), not on every refetch of the saved snapshot.
  useEffect(() => {
    if (!taskId || !loaded) return;
    const controller = new AbortController();
    let closed = false;
    let reconnectTimer: number | undefined;
    let delay = RECONNECT_MIN_MS;
    const stopToolTimer = () => { if (toolTimer.current) { window.clearTimeout(toolTimer.current); toolTimer.current = null; } };
    const onDelta = (delta: TaskDelta) => {
      delay = RECONNECT_MIN_MS;
      if (delta.parentToolUseId) return; // subagent output stays out of the thread
      if (delta.kind === "text" && delta.phase === "start") setDraft({ text: "", settled: false });
      else if (delta.kind === "text" && delta.phase === "delta") setDraft((current) => ({ text: (current?.text || "") + delta.text, settled: false }));
      else if (delta.kind === "block") setDraft((current) => (current && current.text ? { ...current, settled: true } : null));
      else if (delta.kind === "tool") {
        stopToolTimer();
        setStartingTool({ name: delta.name, title: delta.title, at: delta.at });
        toolTimer.current = window.setTimeout(() => { toolTimer.current = null; setStartingTool(null); }, STARTING_TOOL_TTL);
      }
    };
    const onEvent = (event: TaskEvent) => {
      delay = RECONNECT_MIN_MS;
      if (event.seq <= lastSeq.current) return;
      lastSeq.current = event.seq;
      setLive((current) => ({ ...current, events: [...current.events, event] }));
      if (event.type === "assistant.text" && !event.parentToolUseId) setDraft((current) => (current && (current.settled || current.text.trim() === (event.text || "").trim()) ? null : current));
      if (event.type === "tool.use" && !event.parentToolUseId) setStartingTool((current) => { if (current && current.name === event.name) { stopToolTimer(); return null; } return current; });
    };
    const onTask = (task: Task) => {
      delay = RECONNECT_MIN_MS;
      setConnected(true);
      const nextVersion = task.historyVersion || 0;
      if (version.current !== null && nextVersion !== version.current) {
        version.current = nextVersion; lastSeq.current = 0;
        setLive({ task, events: [] }); setDraft(null); stopToolTimer(); setStartingTool(null);
        void queryClient.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
        setGeneration((current) => current + 1);
        return;
      }
      setLive((current) => ({ ...current, task }));
      if (task.status !== "running" && task.status !== "queued") { setDraft(null); stopToolTimer(); setStartingTool(null); }
    };
    const connect = async () => {
      try {
        await tasksApi.stream(taskId, lastSeq.current, { onEvent, onTask, onDelta }, controller.signal);
      } catch {
        // A dropped stream reconnects below; the stored events after `lastSeq` are replayed by the server.
      }
      if (closed || controller.signal.aborted) return;
      setConnected(false);
      reconnectTimer = window.setTimeout(() => { void connect(); }, delay);
      delay = Math.min(delay * 2, RECONNECT_MAX_MS);
    };
    void connect();
    return () => { closed = true; controller.abort(); if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer); setConnected(false); stopToolTimer(); };
  }, [taskId, loaded, queryClient, generation]);

  const task = live.task;
  const events = live.events;
  // Only the approval the task is waiting on right now can be decided. Older requests that were
  // cancelled (a stop, an old restart) stay in the history without buttons.
  const pendingId = task?.pendingApprovalId || null;
  const pendingApproval = useMemo(() => {
    if (!pendingId) return null;
    const decided = new Set(events.filter((event) => event.type === "approval.decided").map((event) => event.inboxId));
    return [...events].reverse().find((event) => event.type === "approval.requested" && event.inboxId === pendingId && !decided.has(event.inboxId)) || null;
  }, [events, pendingId]);
  // Same rule for a question: only the one the task waits on right now takes answers.
  const pendingQuestion = useMemo(() => {
    if (!pendingId) return null;
    const settled = new Set(events.filter((event) => event.type === "question.answered" || event.type === "approval.decided").map((event) => event.inboxId));
    return [...events].reverse().find((event) => event.type === "question.asked" && event.inboxId === pendingId && !settled.has(event.inboxId)) || null;
  }, [events, pendingId]);

  const running = task ? task.status === "running" || task.status === "queued" : false;
  return { task, events, pendingApproval, pendingQuestion, draft: running ? draft : null, startingTool: running ? startingTool : null, connected, isPending: initial.isPending, isFetching: initial.isFetching, error: initial.error, refetch: () => initial.refetch({ cancelRefetch: false }) };
}

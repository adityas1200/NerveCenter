import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { AUTO_REFRESH_SECONDS } from "@/lib/autoRefresh";
import { useProject } from "@/lib/projectContext";

const QUIET_MS = 5_000;
const EDITABLE = "input:not([type=button]):not([type=submit]), textarea, select, [contenteditable=true], [role=textbox]";
const BLOCKER = '[data-auto-refresh-block="true"], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/** FR-3/4: one deadline, no catch-up queue; callbacks always see the current selection. */
export function usePageAutoRefresh({ onRefresh, busy, paused = false }: { onRefresh: () => void; busy: boolean; paused?: boolean }) {
  const client = useQueryClient();
  const location = useLocation();
  const { projectId } = useProject();
  const interval = AUTO_REFRESH_SECONDS * 1000;
  const [remaining, setRemaining] = useState(AUTO_REFRESH_SECONDS);
  const [waiting, setWaiting] = useState(false);
  const current = useRef({ onRefresh, busy, paused });
  current.current = { onRefresh, busy, paused };
  const deadline = useRef(Date.now() + interval);
  const wasBusy = useRef(busy);
  const lastAction = useRef(-Infinity);
  const running = useRef(false);

  const reset = () => {
    deadline.current = Date.now() + interval;
    setRemaining(AUTO_REFRESH_SECONDS);
    setWaiting(false);
  };

  const refresh = () => {
    if (running.current || current.current.busy) return;
    // Reserve the next deadline before dispatch, even if a handler finishes synchronously.
    running.current = true;
    reset();
    try { current.current.onRefresh(); }
    finally { running.current = false; }
  };
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    deadline.current = Date.now() + interval;
    setRemaining(AUTO_REFRESH_SECONDS);
    setWaiting(false);
  }, [interval, location.pathname, location.search, projectId]);

  useEffect(() => {
    if (wasBusy.current && !busy) {
      deadline.current = Date.now() + interval;
      setRemaining(AUTO_REFRESH_SECONDS);
      setWaiting(false);
    }
    wasBusy.current = busy;
  }, [busy, interval]);

  useEffect(() => {
    if (!interval) return;
    const action = () => { lastAction.current = Date.now(); };
    const events = ["pointerdown", "keydown", "input", "change", "scroll"] as const;
    events.forEach(event => document.addEventListener(event, action, { capture: true, passive: true }));
    const timer = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000));
      setRemaining(left);
      if (left > 0) return;
      const blocked = current.current.busy || current.current.paused || document.hidden
        || client.isMutating() > 0 || client.isFetching() > 0
        || document.activeElement?.matches(EDITABLE)
        || document.querySelector(BLOCKER)
        || Date.now() - lastAction.current < QUIET_MS;
      setWaiting(Boolean(blocked));
      if (!blocked) refreshRef.current();
    }, 1000);
    return () => {
      window.clearInterval(timer);
      events.forEach(event => document.removeEventListener(event, action, true));
    };
  }, [client, interval]);

  return { refresh, remaining, waiting, enabled: interval > 0 };
}

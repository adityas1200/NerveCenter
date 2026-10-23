import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Keeps a scroll container pinned to its bottom while the reader is already there (within 80px), and
 * leaves it alone once they scroll up. `hasNew` turns on when content arrived while they were away.
 * `ref` is a callback ref, since the container often mounts after the data loads; `scrollToTop` lets go
 * of the bottom, for a finished task that should open at its start.
 */
export function useStickToBottom<T extends HTMLElement>(signal: unknown) {
  const [node, setNode] = useState<T | null>(null);
  const element = useRef<T | null>(null);
  const atBottom = useRef(true);
  const [away, setAway] = useState(false);
  const [hasNew, setHasNew] = useState(false);
  const ref = useCallback((next: T | null) => { element.current = next; setNode(next); }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const target = element.current;
    if (!target) return;
    if (typeof target.scrollTo === "function") target.scrollTo({ top: target.scrollHeight, behavior });
    else target.scrollTop = target.scrollHeight;
    atBottom.current = true;
    setAway(false);
    setHasNew(false);
  }, []);

  const scrollToTop = useCallback(() => {
    const target = element.current;
    atBottom.current = false;
    if (!target) return;
    if (typeof target.scrollTo === "function") target.scrollTo({ top: 0 });
    else target.scrollTop = 0;
  }, []);

  useEffect(() => {
    if (!node) return;
    const onScroll = () => {
      const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
      const near = distance < 80;
      atBottom.current = near;
      setAway(!near);
      if (near) setHasNew(false);
    };
    node.addEventListener("scroll", onScroll, { passive: true });
    return () => node.removeEventListener("scroll", onScroll);
  }, [node]);

  useEffect(() => {
    const target = element.current;
    if (!target) return;
    if (atBottom.current) {
      if (typeof target.scrollTo === "function") target.scrollTo({ top: target.scrollHeight });
      else target.scrollTop = target.scrollHeight;
    } else {
      setHasNew(true);
    }
  }, [signal, node]);

  return { ref, element, node, away, hasNew, scrollToBottom, scrollToTop };
}

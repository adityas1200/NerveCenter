import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The top bar is `sticky top-0 h-14`; the toolbar pins directly under it. */
const TOPBAR_PX = 56;

/**
 * A list page's search/filter row that stays pinned under the top bar while the list scrolls, so
 * search, filters and the page's "New ..." action stay in reach on a long list.
 *
 * `placement="page"` sits on the page canvas: it bleeds to the page's side padding and paints the
 * canvas colour (the theme variable, so light and dark both work) so rows slide under it cleanly.
 * `placement="card"` sits at the top of a list card: it paints the card's surface and keeps the
 * card's own padding. A card holding one must clip with `overflow-clip`, not `overflow-hidden` -
 * `hidden` makes the card a scroll container and sticky then never leaves it.
 *
 * A hairline appears under it only once it is actually pinned, so it adds no line at the top.
 */
export function ListToolbar({ children, placement = "page", className }: { children: ReactNode; placement?: "page" | "card"; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    let frame = 0;
    // The shell's working panel is the scroll container on a full page; anywhere else it is the window.
    const root = ref.current?.closest<HTMLElement>("[data-scroll-root]") ?? null;
    const target: HTMLElement | Window = root ?? window;
    const measure = () => {
      frame = 0;
      const element = ref.current;
      if (!element) return;
      const scrolled = root ? root.scrollTop : window.scrollY;
      const top = element.getBoundingClientRect().top - (root ? root.getBoundingClientRect().top : 0);
      setStuck(scrolled > 0 && top <= TOPBAR_PX + 0.5);
    };
    // One measurement per frame. `-1` marks "scheduled" before the id is known, so a
    // requestAnimationFrame that runs its callback synchronously can't leave the throttle stuck shut.
    const onScroll = () => {
      if (frame) return;
      frame = -1;
      const id = window.requestAnimationFrame(measure);
      if (frame === -1) frame = id;
    };
    measure();
    target.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => { target.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); if (frame > 0) window.cancelAnimationFrame(frame); };
  }, []);
  return (
    <div
      ref={ref}
      data-list-toolbar=""
      data-stuck={stuck || undefined}
      className={cn(
        "sticky top-14 z-20 flex flex-wrap items-center gap-2 transition-shadow duration-150",
        placement === "page" ? "-mx-5 -my-2 bg-[var(--ops-surface)] px-5 py-2 lg:-mx-7 lg:px-7" : "bg-raised",
        stuck && "shadow-[0_1px_0_var(--ops-line)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

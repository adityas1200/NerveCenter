import { Database, Ticket, Workflow } from "lucide-react";
import { Fragment, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { MENTION_GROUP, mentionOptionId, type Mention, type MentionKind } from "./mentions";

const ICON: Record<MentionKind, typeof Ticket> = { ticket: Ticket, pipeline: Workflow, table: Database };

/** The list the message box shows above itself while an @ is being typed. Keys stay in the box; this only renders and takes clicks. */
export function MentionMenu({ id, items, active, loading, term, onPick, onHover }: { id: string; items: Mention[]; active: number; loading: boolean; term: string; onPick: (mention: Mention) => void; onHover: (index: number) => void }) {
  const list = useRef<HTMLDivElement | null>(null);
  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView?.({ block: "nearest" }); }, [active]);
  let lastGroup = "";
  return (
    <div className="absolute inset-x-0 bottom-full z-20 mb-2 overflow-hidden rounded-xl border border-line-strong bg-raised shadow-modal">
      <div ref={list} id={id} role="listbox" aria-label="Point Sonic at" className="max-h-72 overflow-y-auto overscroll-contain p-1.5">
        {items.length === 0 ? (
          <p className="px-2.5 py-2 text-[13px] text-ink-4">{loading ? "Searching…" : term ? `No ticket, pipeline or table matches “${term}”` : "Type a ticket number, pipeline or table name"}</p>
        ) : items.map((item, index) => {
          const group = MENTION_GROUP[item.kind];
          const header = group !== lastGroup ? group : null;
          lastGroup = group;
          const Icon = ICON[item.kind];
          const selected = index === active;
          return (
            <Fragment key={`${item.kind}:${item.id}`}>
              {header ? <div role="presentation" className="px-2.5 pb-1 pt-2 text-[11.5px] font-medium text-ink-5 first:pt-1">{header}</div> : null}
              <div
                id={mentionOptionId(item)}
                role="option"
                aria-selected={selected}
                data-index={index}
                tabIndex={-1}
                // Keep the caret in the box: a mousedown on the row would otherwise blur it.
                onMouseDown={(event) => { event.preventDefault(); onPick(item); }}
                onMouseMove={() => { if (!selected) onHover(index); }}
                className={cn("flex h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-[13.5px]", selected ? "bg-ink-1/[0.06] text-ink-1" : "text-ink-2")}
              >
                <Icon className={cn("h-3.5 w-3.5 shrink-0", selected ? "text-ink-2" : "text-ink-4")} aria-hidden="true" />
                <span className={cn("min-w-0 shrink-0 truncate", item.kind === "pipeline" ? "max-w-[60%]" : "max-w-[45%] font-mono text-[12.5px]")}>{item.label}</span>
                {item.title && item.title !== item.label ? <span className="min-w-0 flex-1 truncate text-ink-4">{item.title}</span> : <span className="flex-1" />}
                {item.meta ? <span className="shrink-0 text-[12px] text-ink-5">{item.meta}</span> : null}
              </div>
            </Fragment>
          );
        })}
      </div>
      <div className="flex h-8 items-center gap-3 border-t border-line bg-surface-panel px-3 text-[11.5px] text-ink-5">
        <span><kbd className="!text-[10px]">↑</kbd> <kbd className="!text-[10px]">↓</kbd> Move</span>
        <span><kbd className="!text-[10px]">↵</kbd> Add</span>
        <span className="ml-auto"><kbd className="!text-[10px]">Esc</kbd> Close</span>
      </div>
    </div>
  );
}

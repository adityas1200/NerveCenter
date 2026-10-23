import { BookmarkPlus } from "lucide-react";
import { Link } from "react-router-dom";
import { fieldLabel } from "@/features/knowledge/knowledgeMapLayout";
import { knowledgePlace } from "./stepLabels";
import type { TeachMoment } from "./teachMoments";

/**
 * Teach moments (SPEC-knowledge-05 FR-5): when a person corrects Sonic and it saves what they said, the turn shows a
 * small "Saved for review" card with what was saved and who said it, so the person sees it landed without being asked.
 */

export function TeachCard({ moment, compact = false }: { moment: TeachMoment; compact?: boolean }) {
  const fields = Object.entries(moment.fields).slice(0, 4);
  return (
    <section className="flex items-start gap-3 rounded-xl border border-violet-200 bg-violet-50/40 px-3.5 py-3" aria-label="Saved for review" data-testid="teach-card">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-violet-100 text-violet-700"><BookmarkPlus className="h-3.5 w-3.5" aria-hidden="true" /></span>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-medium text-violet-700">Saved for review</p>
        <p className="mt-0.5 truncate text-[13.5px] font-semibold text-ink-1" title={moment.title}>{moment.title}</p>
        <p className="mt-0.5 flex flex-wrap gap-x-1.5 text-[12.5px] text-ink-4">
          <span className="truncate">{knowledgePlace(moment.path)}</span>
          {moment.taughtBy ? <><span aria-hidden="true">·</span><span>From {moment.taughtBy}</span></> : null}
        </p>
        {fields.length && !compact ? (
          <p className="mt-1.5 flex flex-wrap gap-1">
            {fields.map(([key, value]) => <span key={key} className="rounded-md bg-raised px-1.5 py-0.5 text-[12px] text-ink-3 ring-1 ring-line"><span className="text-ink-5">{fieldLabel(key)}</span> {Array.isArray(value) ? value.join(", ") : value}</span>)}
          </p>
        ) : moment.excerpt && !compact ? <p className="mt-1 line-clamp-2 text-[12.5px] leading-[18px] text-ink-3">{moment.excerpt}</p> : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 text-[12.5px] font-medium">
        <Link to={moment.link} className="text-brand hover:text-brand-hover">Open draft</Link>
        {moment.base ? <Link to={`/knowledge/${encodeURIComponent(moment.base)}?drafts=1`} className="text-ink-4 hover:text-ink-1">Review</Link> : null}
      </div>
    </section>
  );
}

import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { projectsApi, type Person } from "@/api/projects";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui";
import { cn } from "@/lib/utils";
import { FRESH } from "@/api/queryPolicy";
import { queryKeys } from "@/api/queryKeys";

/**
 * Finds someone who has signed in, by name, id or email (`GET /api/people`), for the create flow, a project's People tab
 * and the admin console (SPEC-projects-03 FR-3). Only people in the directory can be added, so there is nothing to type wrong.
 */
export function PersonPicker({ onPick, exclude = [], placeholder = "Find a person", className, inputClassName }: { onPick: (person: Person) => void; exclude?: string[]; placeholder?: string; className?: string; inputClassName?: string }) {
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const listId = useId();
  useEffect(() => { const timer = window.setTimeout(() => setQuery(text.trim()), 180); return () => window.clearTimeout(timer); }, [text]);
  const people = useQuery({ queryKey: queryKeys.auth.people(query), queryFn: ({ signal }) => projectsApi.people(query, signal), enabled: open && query.length > 0, staleTime: FRESH.medium });
  const skip = new Set(exclude.map((id) => id.toLowerCase()));
  const results = (people.data?.items ?? []).filter((person) => !skip.has(person.id.toLowerCase())).slice(0, 8);
  const pick = (person: Person) => { onPick(person); setText(""); setQuery(""); setOpen(false); };
  const anchor = useRef<HTMLLabelElement>(null);
  const listOpen = Boolean(open && query && (results.length || people.isFetched));
  return (
    // The list is portalled so a card with overflow-hidden (every Settings section) cannot clip it.
    <Popover open={listOpen} onOpenChange={(next) => { if (!next) setOpen(false); }}>
      <div className={className}>
        <PopoverAnchor asChild>
          <label ref={anchor} className={cn("flex h-11 items-center gap-2 rounded-xl border border-ink-1/[0.12] bg-raised px-3.5 text-ink-4 transition-[border-color,box-shadow] focus-within:border-brand focus-within:shadow-[0_0_0_4px_rgb(var(--c-brand)/0.14)]", inputClassName)}>
            <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
            <input
              value={text}
              onChange={(event) => { setText(event.target.value); setOpen(true); }}
              onFocus={() => setOpen(true)}
              onBlur={() => window.setTimeout(() => setOpen(false), 150)}
              onKeyDown={(event) => { if (event.key === "Enter" && results[0]) { event.preventDefault(); pick(results[0]); } if (event.key === "Escape") setOpen(false); }}
              placeholder={placeholder}
              aria-label={placeholder}
              role="combobox"
              aria-controls={listId}
              aria-expanded={open && results.length > 0}
              aria-autocomplete="list"
              className="h-full min-w-0 flex-1 border-0 bg-transparent text-[14px] text-ink-1 outline-none placeholder:text-ink-5"
            />
          </label>
        </PopoverAnchor>
        {/* Focus stays in the input while the list is open; a click on the input is not a click outside. */}
        <PopoverContent align="start" sideOffset={6} onOpenAutoFocus={(event) => event.preventDefault()} onInteractOutside={(event) => { if (anchor.current?.contains(event.target as Node)) event.preventDefault(); }} className="w-[var(--radix-popover-trigger-width)] rounded-xl p-0 shadow-pop">
          <ul id={listId} role="listbox" className="max-h-72 overflow-y-auto p-1">
            {results.map((person) => (
              <li key={person.id}>
                <button type="button" role="option" aria-selected={false} onMouseDown={(event) => event.preventDefault()} onClick={() => pick(person)} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-surface-subtle">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium text-ink-1">{person.name}</span>
                    <span className="block truncate text-[12px] text-ink-4">{person.email || person.id}</span>
                  </span>
                </button>
              </li>
            ))}
            {!results.length ? <li className="px-2.5 py-2 text-[13px] text-ink-4">No one by that name has signed in</li> : null}
          </ul>
        </PopoverContent>
      </div>
    </Popover>
  );
}

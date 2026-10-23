import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, X } from "lucide-react";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { knowledgeApi, knowledgeKeys, type KnowledgeMap as KnowledgeMapData } from "@/api/library";
import { AnimatedNumber } from "@/components/ops/AnimatedNumber";
import { EmptyState } from "@/components/ops/EmptyState";
import { StatCell, StatStrip } from "@/components/ops/StatStrip";
import { QueryState } from "@/components/ops/StatePanels";
import { Button, SearchInput, Tabs, TabsList, TabsTrigger } from "@/components/ui";
import { cn } from "@/lib/utils";
import { MAP_SIZE, MAX_NODES, VIEW, fieldLabel, landmarks, layoutMap, neighbourhood, nodeState, searchNodes, shelfLabel, stateRing, type MapLayout, type NodeState, type PlacedNode } from "./knowledgeMapLayout";

/**
 * The knowledge map of one base (SPEC-knowledge-04 FR-11, FR-12): every page as a point on its shelf's sector, typed
 * links as curves through the middle. Colour is state only: violet waits for review, amber is past its review date,
 * grey is kept. Hover or pick a page to light its links and read it in the side panel; arrow keys walk the pages.
 */

const STATE_DOT: Record<NodeState, string> = { draft: "fill-violet-500", stale: "fill-amber-500", kept: "fill-ink-3" };
const STATE_STROKE: Record<NodeState, string> = { draft: "stroke-violet-500", stale: "stroke-amber-500", kept: "stroke-ink-4/50" };
const STATE_WORD: Record<NodeState, { label: string; className: string }> = {
  draft: { label: "Needs review", className: "bg-violet-50 text-violet-700 ring-violet-200" },
  stale: { label: "Past review date", className: "bg-amber-50 text-amber-800 ring-amber-200" },
  kept: { label: "Kept", className: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
};
type StateFilter = "all" | "draft" | "stale";

export function KnowledgeMap({ base, onOpenPage }: { base: string; onOpenPage: (path: string) => void }) {
  const query = useQuery({ queryKey: knowledgeKeys.map(base), queryFn: ({ signal }) => knowledgeApi.map(base, signal) });
  return (
    <QueryState query={query} tiles={4}>
      {query.data ? <MapView data={query.data} onOpenPage={onOpenPage} /> : null}
    </QueryState>
  );
}

function MapView({ data, onOpenPage }: { data: KnowledgeMapData; onOpenPage: (path: string) => void }) {
  const layout = useMemo(() => layoutMap(data), [data]);
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [shelves, setShelves] = useState<Set<string>>(new Set());
  const [state, setState] = useState<StateFilter>("all");
  const [search, setSearch] = useState("");
  const svgRef = useRef<SVGSVGElement>(null);
  const matches = useMemo(() => searchNodes(layout.nodes, search), [layout.nodes, search]);
  const matchSet = useMemo(() => new Set(matches.map((node) => node.path)), [matches]);

  // A page is in view when it passes the shelf, state and search filters; the rest stay in place, faded.
  const inView = (node: PlacedNode) => (!shelves.size || shelves.has(node.shelf)) && (state === "all" || nodeState(node) === state) && (!search.trim() || matchSet.has(node.path));
  const visible = layout.nodes.filter(inView);
  const focus = hovered || selected;
  const near = useMemo(() => (focus ? neighbourhood(layout, focus) : null), [layout, focus]);
  const current = selected ? layout.byPath.get(selected) || null : null;
  const hubs = useMemo(() => landmarks(layout), [layout]);

  if (!data.pages.length) return <EmptyState title="No pages yet" body="Pages appear here once the base has markdown files." />;

  const toggleShelf = (name: string) => setShelves((now) => { const next = new Set(now); if (next.has(name)) next.delete(name); else next.add(name); return next; });
  const step = (direction: 1 | -1) => {
    if (!visible.length) return;
    const at = visible.findIndex((node) => node.path === selected);
    const next = visible[(at + direction + visible.length) % visible.length] || visible[0];
    setSelected(next.path);
  };
  const onKey = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") { event.preventDefault(); step(1); }
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") { event.preventDefault(); step(-1); }
    else if (event.key === "Enter" && selected) { event.preventDefault(); onOpenPage(selected); }
    else if (event.key === "Escape") setSelected(null);
  };
  const labelled = new Set<string>(near ? [...near.paths].slice(0, 14) : hubs);

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <StatStrip columns={4}>
        <StatCell label="Pages" value={data.totals.pages} note={data.totals.orphans ? `${data.totals.orphans} not linked to any page` : "Every page is linked"} />
        <StatCell label="Typed links" value={data.totals.links} hint="Links between pages from their frontmatter fields: brands, upstream, stakeholders and the rest." />
        <StatCell label="Needs review" value={data.totals.drafts} tone="violet" hint="Drafts Sonic saved that a person has not kept or discarded yet." />
        <StatCell label="Past review date" value={data.totals.stale} tone="amber" hint="Pages whose stale_after date has passed." />
      </StatStrip>

      <section className="overflow-hidden rounded-2xl border border-line bg-raised shadow-card" aria-label="Knowledge map">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <SearchInput value={search} onValueChange={setSearch} label="Find a page" className="w-full sm:w-64"
            onKeyDown={(event) => { if (event.key === "Enter" && matches[0]) { setSelected(matches[0].path); svgRef.current?.focus(); } }} />
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by shelf">
            {layout.shelves.map((shelf) => (
              <button key={shelf.name} type="button" aria-pressed={shelves.has(shelf.name)} onClick={() => toggleShelf(shelf.name)}
                className={cn("inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/25",
                  shelves.has(shelf.name) ? "border-brand/60 bg-brand/[0.07] text-ink-1" : "border-line text-ink-3 hover:border-line-strong hover:text-ink-1")}>
                {shelf.label}<span className="font-mono text-[11px] tabular-nums text-ink-5">{shelf.pages}</span>
              </button>
            ))}
            {shelves.size ? <button type="button" onClick={() => setShelves(new Set())} className="h-7 px-1.5 text-[12px] font-medium text-brand hover:text-brand-hover">Clear {shelves.size}</button> : null}
          </div>
          <Tabs value={state} onValueChange={(value) => setState(value as StateFilter)} className="ml-auto">
            <TabsList aria-label="Filter by state">
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="draft">Needs review</TabsTrigger>
              <TabsTrigger value="stale">Past review</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {search.trim() ? (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2 text-[12.5px]" aria-live="polite">
            <span className="text-ink-4">{matches.length ? `${matches.length}${matches.length === 8 ? "+" : ""} found` : "No page matches"}</span>
            {matches.map((node) => <button key={node.path} type="button" onClick={() => setSelected(node.path)} className={cn("rounded-md px-2 py-0.5 font-medium text-ink-2 hover:bg-ink-1/5", selected === node.path && "bg-brand/[0.08] text-ink-1")}>{node.title}</button>)}
          </div>
        ) : null}

        <div className="grid lg:grid-cols-[minmax(0,1fr)_320px]">
          {/* As large as fits under the toolbar, never taller than the window. */}
          <div className="relative mx-auto my-2" style={{ width: `min(100%, calc((100dvh - 420px) * ${(VIEW.width / VIEW.height).toFixed(4)}))`, aspectRatio: `${VIEW.width} / ${VIEW.height}`, minWidth: 320 }}>
            <svg ref={svgRef} viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.width} ${VIEW.height}`} className="absolute inset-0 h-full w-full select-none focus-visible:outline-none" tabIndex={0} onKeyDown={onKey}
              role="group" aria-label={`Map of ${data.totals.pages} pages and ${data.totals.links} links. Arrow keys move between pages, Enter opens one, Escape clears.`}
              onClick={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
              <Guides layout={layout} activeShelf={current?.shelf ?? null} totals={data.totals} />
              <g aria-hidden="true">
                {layout.links.map((link, index) => {
                  const lit = near ? near.paths.has(link.from) && near.paths.has(link.to) && (link.from === focus || link.to === focus) : false;
                  return <path key={link.id} d={link.d} pathLength={1} fill="none" strokeLinecap="round" className={cn("chart-line transition-[stroke-opacity,stroke-width] duration-200", lit ? "stroke-brand" : "stroke-ink-4")}
                    strokeOpacity={near ? (lit ? 0.95 : 0.05) : link.crossShelf ? 0.16 : 0.26} strokeWidth={lit ? 2.2 : 1.1} style={{ animationDelay: `${120 + (index % 40) * 8}ms` }} />;
                })}
              </g>
              <g>
                {layout.nodes.map((node) => {
                  const shown = inView(node);
                  const dim = (near && !near.paths.has(node.path)) || !shown;
                  const isSelected = node.path === selected;
                  return (
                    <g key={node.path} role="button" tabIndex={-1} aria-label={`${node.title}, ${STATE_WORD[nodeState(node)].label.toLowerCase()}`} aria-pressed={isSelected}
                      className="cursor-pointer outline-none" opacity={dim ? 0.16 : 1} style={{ transition: "opacity 200ms ease" }}
                      onMouseEnter={() => setHovered(node.path)} onMouseLeave={() => setHovered(null)} onClick={() => setSelected(isSelected ? null : node.path)} onDoubleClick={() => onOpenPage(node.path)}>
                      {isSelected ? <circle cx={node.x} cy={node.y} r={node.r + 6} className="fill-none stroke-brand" strokeWidth={2} /> : null}
                      {matchSet.has(node.path) && !isSelected ? <circle cx={node.x} cy={node.y} r={node.r + 4} className="fill-none stroke-brand/60" strokeWidth={1.5} /> : null}
                      <circle cx={node.x} cy={node.y} r={node.r} className={cn("map-node", STATE_DOT[nodeState(node)])} stroke="rgb(var(--c-raised))" strokeWidth={2} style={{ animationDelay: `${Math.min(node.index, 160) * 4}ms` }} />
                      <circle cx={node.x} cy={node.y} r={Math.max(12, node.r + 5)} fill="transparent" />
                    </g>
                  );
                })}
              </g>
              <g aria-hidden="true" pointerEvents="none">
                {layout.nodes.filter((node) => labelled.has(node.path)).map((node) => <NodeLabel key={node.path} node={node} strong={node.path === focus} quiet={!near} />)}
              </g>
            </svg>
            <div className="pointer-events-none absolute left-1/2 top-1/2 flex w-[16%] -translate-x-1/2 -translate-y-1/2 flex-col items-center text-center">
              <span className="font-display text-[clamp(22px,2.6vw,34px)] font-semibold leading-none tracking-[-0.025em] tabular-nums text-ink-1"><AnimatedNumber value={data.totals.pages} /></span>
              <span className="mt-1 text-[12px] text-ink-4">pages</span>
              <span className="mt-1.5 max-w-full truncate text-[12.5px] font-medium text-ink-2" title={data.title}>{data.title}</span>
            </div>
            <span className="sr-only" aria-live="polite">{current ? `${current.title} selected` : ""}</span>
          </div>
          <aside className="border-t border-line p-4 lg:border-l lg:border-t-0" aria-label={current ? `About ${current.title}` : "Shelves"}>
            {current ? <PageDetail node={current} layout={layout} onSelect={setSelected} onClose={() => setSelected(null)} onOpen={() => onOpenPage(current.path)} />
              : <ShelfList layout={layout} active={shelves} onToggle={toggleShelf} />}
          </aside>
        </div>
        {data.truncated || data.pages.length > MAX_NODES ? <p className="border-t border-line px-4 py-2 text-[12.5px] text-ink-4">Showing the first {Math.min(MAX_NODES, data.pages.length)} pages. Filter by shelf in the Files view to read the rest.</p> : null}
      </section>
    </div>
  );
}

/** The frame the points sit in: a band per shelf, faint rings, the shelf names, and the state ring round the centre. */
function Guides({ layout, activeShelf, totals }: { layout: MapLayout; activeShelf: string | null; totals: KnowledgeMapData["totals"] }) {
  const c = MAP_SIZE / 2;
  return (
    <g aria-hidden="true" pointerEvents="none">
      {layout.shelves.map((shelf, index) => <path key={`band-${shelf.name}`} d={shelf.sector} className={shelf.name === activeShelf ? "fill-brand/[0.06]" : index % 2 ? "fill-ink-1/[0.018]" : "fill-ink-1/[0.035]"} style={{ transition: "fill 200ms ease" }} />)}
      {[290, 365].map((r) => <circle key={r} cx={c} cy={c} r={r} className="fill-none stroke-line" strokeWidth={1} strokeDasharray="2 7" />)}
      <circle cx={c} cy={c} r={112} className="fill-raised stroke-line" strokeWidth={1} />
      {stateRing(totals, 128).map((part) => <path key={part.state} d={part.d} fill="none" strokeLinecap="round" strokeWidth={7} className={STATE_STROKE[part.state]} />)}
      {layout.shelves.map((shelf) => {
        const active = shelf.name === activeShelf;
        return (
          <g key={shelf.name}>
            <path d={shelf.arc} fill="none" strokeLinecap="round" className={active ? "stroke-brand" : "stroke-ink-4"} strokeWidth={active ? 4 : 2.5} strokeOpacity={active ? 1 : 0.5} />
            <text x={shelf.labelX} y={shelf.labelY} textAnchor={shelf.anchor} dominantBaseline="middle" className={cn("text-[21px] font-semibold", active ? "fill-ink-1" : "fill-ink-2")}>
              {shelf.label}
              <tspan dx={7} className="fill-ink-5 font-mono text-[17px] font-medium">{shelf.pages}</tspan>
              {shelf.drafts ? <tspan dx={6} className="fill-violet-600 font-mono text-[15px] font-medium">{shelf.drafts}</tspan> : null}
              {shelf.stale ? <tspan dx={6} className="fill-amber-600 font-mono text-[15px] font-medium">{shelf.stale}</tspan> : null}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function NodeLabel({ node, strong, quiet = false }: { node: PlacedNode; strong: boolean; quiet?: boolean }) {
  const right = Math.cos(node.angle) >= 0;
  const text = node.title.length > 30 ? `${node.title.slice(0, 29)}…` : node.title;
  return (
    <text x={node.x + (right ? -(node.r + 7) : node.r + 7)} y={node.y} textAnchor={right ? "end" : "start"} dominantBaseline="middle"
      className={cn(quiet ? "fill-ink-3 text-[16px] font-medium" : strong ? "fill-ink-1 text-[18px] font-semibold" : "fill-ink-2 text-[17px] font-medium")} stroke="rgb(var(--c-raised))" strokeWidth={5} strokeLinejoin="round" style={{ paintOrder: "stroke" }}>
      {text}
    </text>
  );
}

function ShelfList({ layout, active, onToggle }: { layout: MapLayout; active: Set<string>; onToggle: (name: string) => void }) {
  const max = Math.max(1, ...layout.shelves.map((shelf) => shelf.pages));
  return (
    <div>
      <h3 className="text-[13px] font-medium text-ink-4">Shelves</h3>
      <ul className="stagger-children mt-2 space-y-1">
        {layout.shelves.map((shelf) => (
          <li key={shelf.name}>
            <button type="button" onClick={() => onToggle(shelf.name)} aria-pressed={active.has(shelf.name)} className={cn("w-full rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-ink-1/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/25", active.has(shelf.name) && "bg-brand/[0.06]")}>
              <span className="flex items-baseline gap-2 text-[13px]">
                <span className="min-w-0 flex-1 truncate font-medium text-ink-1">{shelf.label}</span>
                {shelf.drafts ? <span className="font-mono text-[11.5px] tabular-nums text-violet-700" title="Needs review">{shelf.drafts}</span> : null}
                {shelf.stale ? <span className="font-mono text-[11.5px] tabular-nums text-amber-700" title="Past review date">{shelf.stale}</span> : null}
                <span className="font-mono text-[11.5px] tabular-nums text-ink-4">{shelf.pages}</span>
              </span>
              <span className="mt-1 block h-1 overflow-hidden rounded-full bg-ink-1/[0.05]"><span className="chart-bar-part block h-full rounded-full bg-ink-4/50" style={{ width: `${(shelf.pages / max) * 100}%` }} /></span>
            </button>
          </li>
        ))}
      </ul>
      <dl className="mt-5 space-y-1.5 text-[12.5px] text-ink-3">
        {(["kept", "draft", "stale"] as NodeState[]).map((key) => (
          <div key={key} className="flex items-center gap-2"><svg width={10} height={10} aria-hidden="true"><circle cx={5} cy={5} r={4} className={STATE_DOT[key]} /></svg><dt>{STATE_WORD[key].label}</dt></div>
        ))}
      </dl>
      <p className="mt-4 text-[12.5px] leading-5 text-ink-4">Pick a page to see what it links to and what links to it.</p>
    </div>
  );
}

function PageDetail({ node, layout, onSelect, onClose, onOpen }: { node: PlacedNode; layout: MapLayout; onSelect: (path: string) => void; onClose: () => void; onOpen: () => void }) {
  const near = neighbourhood(layout, node.path);
  const word = STATE_WORD[nodeState(node)];
  const outgoing = groupBy(node.links.map((link) => ({ field: link.field, label: link.page ? layout.byPath.get(link.page)?.title || link.target : link.target, page: link.page && layout.byPath.has(link.page) ? link.page : null })));
  const incoming = groupBy(near.in.map((item) => ({ field: item.field, label: layout.byPath.get(item.path)?.title || item.path, page: item.path })));
  const fields = Object.entries(node.fields);
  const owner = node.links.some((link) => link.field === "owner") ? null : node.owner;
  return (
    <div className="animate-fade-in">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold leading-5 text-ink-1">{node.title}</h3>
          <p className="mt-0.5 truncate font-mono text-[11.5px] text-ink-5" title={node.path}>{node.path}</p>
        </div>
        <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" aria-label="Clear selection" onClick={onClose}><X className="h-3.5 w-3.5" /></Button>
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[12.5px] text-ink-4">
        <span className={cn("rounded-full px-1.5 py-px text-[11px] font-semibold ring-1", word.className)}>{word.label}</span>
        {node.type ? <span>{node.type}</span> : null}
        <span aria-hidden="true">·</span><span>{shelfLabel(node.shelf)}</span>
        {node.staleAfter ? <><span aria-hidden="true">·</span><span>Review by {node.staleAfter}</span></> : null}
      </p>
      {node.description ? <p className="mt-2 text-[13px] leading-5 text-ink-2">{node.description}</p> : null}
      {fields.length || owner ? (
        <dl className="mt-3 grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12.5px]">
          {owner ? <><dt className="text-ink-4">Owner</dt><dd className="truncate text-ink-1">{owner}</dd></> : null}
          {fields.map(([key, value]) => <FieldRow key={key} label={fieldLabel(key)} value={value} />)}
        </dl>
      ) : null}
      <LinkGroups title="Links to" groups={outgoing} onSelect={onSelect} empty="No typed links" />
      <LinkGroups title="Linked from" groups={incoming} onSelect={onSelect} empty="Nothing links here yet" />
      <Button size="sm" variant="primary" className="mt-4" onClick={onOpen}>Open page<ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" /></Button>
    </div>
  );
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return <><dt className="text-ink-4">{label}</dt><dd className="truncate text-ink-1" title={value}>{value}</dd></>;
}

type LinkItem = { field: string; label: string; page: string | null };
function groupBy(items: LinkItem[]): Array<[string, LinkItem[]]> {
  const groups = new Map<string, LinkItem[]>();
  for (const item of items) groups.set(item.field, [...(groups.get(item.field) || []), item]);
  return [...groups.entries()];
}

function LinkGroups({ title, groups, onSelect, empty }: { title: string; groups: Array<[string, LinkItem[]]>; onSelect: (path: string) => void; empty: string }) {
  return (
    <section className="mt-4">
      <h4 className="text-[12px] font-medium text-ink-5">{title}</h4>
      {groups.length ? (
        <dl className="mt-1.5 space-y-2">
          {groups.map(([field, items]) => (
            <div key={field}>
              <dt className="text-[11.5px] text-ink-4">{fieldLabel(field)}</dt>
              <dd className="mt-0.5 flex flex-wrap gap-1">
                {items.map((item, index) => item.page
                  ? <button key={`${item.page}-${index}`} type="button" onClick={() => onSelect(item.page!)} className="rounded-md border border-line px-1.5 py-0.5 text-[12px] font-medium text-ink-1 hover:border-brand/50 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/25">{item.label}</button>
                  : <span key={`${item.label}-${index}`} className="rounded-md bg-surface-subtle px-1.5 py-0.5 text-[12px] text-ink-3" title="No page for this yet">{item.label}</span>)}
              </dd>
            </div>
          ))}
        </dl>
      ) : <p className="mt-1 text-[12.5px] text-ink-5">{empty}</p>}
    </section>
  );
}


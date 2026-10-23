import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { Globe2, PencilLine, Plus, type LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { boardKeys, boardsApi, type BoardSummary } from "@/api/boards";
import { useMe } from "@/auth/rbac";
import { AGENT_NAME, useAgentScreen, useAskSonic } from "@/components/ops/agentPanelContext";
import { ListToolbar } from "@/components/ops/ListToolbar";
import { Pager } from "@/components/ops/Pager";
import { OpsPage } from "@/components/ops/OpsPage";
import { RefreshButton } from "@/components/ops/RefreshButton";
import { StatCell, StatStrip } from "@/components/ops/StatStrip";
import { QueryState } from "@/components/ops/StatePanels";
import { Button, Card, RelativeTime, SearchInput } from "@/components/ui";
import { BoardMiniature } from "./BoardMiniature";
import { PersonAvatar } from "@/components/ops/PersonAvatar";
import { plural } from "@/lib/utils";
import { GRID_PAGE_SIZES, usePager } from "@/lib/usePager";

/**
 * Boards: dashboards people build with Sonic and publish for everyone. Published boards first, then
 * the reader's own drafts (every draft for an admin). Building starts as a prompt to Sonic, not a form.
 */

export const NEW_BOARD_PROMPT = "Build me a new board. Ask me what it should show, then create it as a draft and give me the link.";


export function BoardsPage() {
  const me = useMe();
  const builder = me.data?.role === "admin" || me.data?.role === "developer";
  const admin = me.data?.role === "admin";
  const askSonic = useAskSonic();
  const query = useQuery({ queryKey: boardKeys.list(), queryFn: ({ signal }) => boardsApi.list(signal) });
  const items = useMemo(() => query.data?.items ?? [], [query.data?.items]);
  const published = useMemo(() => items.filter((board) => board.status === "published"), [items]);
  const drafts = useMemo(() => items.filter((board) => board.status !== "published"), [items]);
  const [search, setSearch] = useState("");
  const term = search.trim().toLowerCase();
  const matches = useCallback((board: BoardSummary) => !term || `${board.title} ${board.description || ""}`.toLowerCase().includes(term), [term]);
  const visiblePublished = useMemo(() => published.filter(matches), [published, matches]);
  const visibleDrafts = useMemo(() => drafts.filter(matches), [drafts, matches]);

  useAgentScreen({
    visible: items.map((board) => `${board.title} (${board.id})`),
    summary: `${plural(items.length, "board")}: ${published.length} published, ${drafts.length} ${drafts.length === 1 ? "draft" : "drafts"}`,
  });

  const newBoard = () => askSonic({ kind: "boards", id: "new" }, NEW_BOARD_PROMPT);

  return (
    <OpsPage
      title="Boards"
      actions={<RefreshButton autoRefresh onClick={() => void query.refetch({ cancelRefetch: false })} busy={query.isFetching} updatedAt={query.dataUpdatedAt || null} />}
    >
      <div className="space-y-6">
        {items.length ? <BoardStats total={items.length} published={published.length} drafts={drafts.length} /> : null}
        <ListToolbar>
          <SearchInput className="min-w-[240px] flex-1" label="Search boards" value={search} onValueChange={setSearch} />
          {builder ? (
            <Button size="sm" variant="primary" onClick={newBoard}>
              <Plus className="h-4 w-4" aria-hidden="true" />New board
            </Button>
          ) : null}
        </ListToolbar>
        <QueryState query={query} tiles={0}>
          {items.length ? (
            <div className="space-y-8">
              <BoardSection title="Published" icon={Globe2} boards={visiblePublished} resetKey={term} emptyText={term ? "No published boards match" : "Nothing published yet"} />
              {drafts.length ? <BoardSection title={admin ? "Drafts" : "Your drafts"} icon={PencilLine} boards={visibleDrafts} prefix="drafts" resetKey={term} emptyText={term ? "No drafts match" : undefined} /> : null}
            </div>
          ) : (
            <Card className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
              <p className="text-[15px] font-semibold text-ink-1">{builder ? "No boards yet" : "Nothing published yet"}</p>
              <p className="max-w-sm text-[13.5px] leading-5 text-ink-4">{builder ? `Describe the dashboard; ${AGENT_NAME} drafts it for you to publish.` : "Published boards appear here."}</p>
              {builder ? <Button size="sm" variant="primary" className="mt-2" onClick={newBoard}><Plus className="h-4 w-4" aria-hidden="true" />Build one with {AGENT_NAME}</Button> : null}
            </Card>
          )}
        </QueryState>
      </div>
    </OpsPage>
  );
}

/** Three flat tiles above the list: how many boards, how many are live, how many are still drafts. */
function BoardStats({ total, published, drafts }: { total: number; published: number; drafts: number }) {
  return (
    <StatStrip columns={3} className="grid-cols-3">
      <StatCell label="Boards" value={total} />
      <StatCell label="Live" value={published} suffix={`of ${total}`} tone="emerald" />
      <StatCell label="Drafts" value={drafts} suffix={`of ${total}`} tone="amber" />
    </StatStrip>
  );
}

/** `prefix` keeps the drafts' page apart from the published boards' page in the URL. */
function BoardSection({ title, icon: Icon, boards, emptyText, prefix, resetKey }: { title: string; icon: LucideIcon; boards: BoardSummary[]; emptyText?: string; prefix?: string; resetKey: string }) {
  const pager = usePager(boards.length, { sizes: GRID_PAGE_SIZES, prefix, resetKey });
  return (
    <section aria-label={title}>
      <h2 className="mb-3 flex items-center gap-2 text-[12px] font-medium text-ink-5">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {title}
        <span className="tabular-nums text-ink-4">{boards.length}</span>
        <span aria-hidden="true" className="ml-1 h-px flex-1 bg-line" />
      </h2>
      {boards.length ? (
        <div className="space-y-4">
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {pager.slice(boards).map((board, index) => <BoardCard key={board.id} board={board} index={index} />)}
          </ul>
          {boards.length > GRID_PAGE_SIZES[0] ? <Card className="overflow-hidden"><Pager {...pager.pagerProps} noun="boards" /></Card> : null}
        </div>
      ) : <p className="rounded-xl border border-dashed border-line px-4 py-5 text-center text-[13.5px] text-ink-4">{emptyText}</p>}
    </section>
  );
}

const STATS: Array<{ key: "widgets" | "filters" | "views"; label: string }> = [
  { key: "widgets", label: "Widgets" },
  { key: "filters", label: "Filters" },
  { key: "views", label: "Views" },
];

/**
 * A board as a card: a miniature of its real layout on top, then its title and state, what it is
 * for, its size and who owns it. The miniature draws the board's own widgets by kind, never numbers.
 */
function BoardCard({ board, index }: { board: BoardSummary; index: number }) {
  const owner = board.owner?.name || board.owner?.id || "";
  const draft = board.status !== "published";
  return (
    <li className={index < 12 ? "stagger-in" : undefined} style={index < 12 ? { animationDelay: `${index * 30}ms` } : undefined}>
      <Link
        to={`/boards/${encodeURIComponent(board.id)}`}
        className="group motion-surface flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-raised shadow-card hover:-translate-y-0.5 hover:border-line-strong hover:shadow-card-hover focus-visible:border-brand/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/25"
      >
        <BoardMiniature boardId={board.id} count={board.widgets} />
        <span className="flex flex-1 flex-col p-4">
        <span className="flex items-start justify-between gap-3">
          <span className="min-w-0 truncate text-[15px] font-semibold text-ink-1">{board.title}</span>
          {draft
            ? <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Draft</span>
            : <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700"><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Live</span>}
        </span>
        <span className="mt-1.5 line-clamp-2 min-h-[40px] text-[13.5px] leading-5 text-ink-3" title={board.description || undefined}>{board.description || <span className="text-ink-5">No description</span>}</span>
        <span className="mt-4 flex items-center gap-4 text-[12.5px] text-ink-4">
          {STATS.map((stat) => {
            const value = board[stat.key] || 0;
            return <span key={stat.key} className="flex items-baseline gap-1" title={plural(value, stat.label.toLowerCase().replace(/s$/, ""))}><span className="font-semibold tabular-nums text-ink-1">{value.toLocaleString()}</span><span>{value === 1 ? stat.label.replace(/s$/, "") : stat.label}</span></span>;
          })}
        </span>
        <span className="mt-3 flex items-center gap-2 border-t border-line pt-3 text-[12.5px] text-ink-4">
          <PersonAvatar name={owner} size={22} />
          <span className="min-w-0 truncate font-medium text-ink-2">{owner}</span>
          <span aria-hidden="true">·</span>
          <span className="shrink-0">Updated <RelativeTime value={board.updatedAt} className="text-[12.5px] text-ink-4" /></span>
        </span>
        </span>
      </Link>
    </li>
  );
}

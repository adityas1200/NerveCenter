import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { platformApi } from "@/api/platform";
import { queryKeys } from "@/api/queryKeys";
import { ticketsApi } from "@/api/tickets";
import { listItems } from "@/api/types";
import { statusMeta } from "@/components/ops/OperationalStatus";
import { isClosed } from "@/features/tickets/ticketFields";
import { rankMentions, typedTable, type Mention } from "./mentions";
import { platformLabel } from "@/lib/platform";
import { FRESH } from "@/api/queryPolicy";


/**
 * What the @ menu offers for `term` (null while no @ is being typed, so nothing loads until then):
 * tickets and pipelines from the app's own lists, tables from the connected platform's catalog search.
 * Open tickets come first when nothing is typed yet. Pipelines show their platform, not a status: the
 * inventory does not carry the latest run, so a status here could contradict the Pipelines page.
 */
export function useMentionCandidates(term: string | null): { items: Mention[]; loading: boolean } {
  const active = term !== null;
  const tickets = useQuery({ queryKey: queryKeys.tickets.list("all"), queryFn: ({ signal }) => ticketsApi.list("all", signal), enabled: active, staleTime: FRESH.medium });
  const pipelines = useQuery({ queryKey: queryKeys.pipelines.list({ mentions: true }), queryFn: ({ signal }) => platformApi.pipelines(undefined, signal), enabled: active, staleTime: FRESH.session });
  const search = useDebounced(term?.trim() ?? "", 250);
  // A platform without a catalog and schema set answers with an error; the menu then offers typed names only.
  const tables = useQuery({ queryKey: queryKeys.dataPlatform.tables(search), queryFn: ({ signal }) => platformApi.tables(search, undefined, signal), enabled: active && search.length >= 2, staleTime: FRESH.session, retry: false });

  const items = useMemo(() => {
    if (term === null) return [];
    const ticketMentions = listItems(tickets.data)
      .slice()
      .sort((a, b) => Number(isClosed(a)) - Number(isClosed(b)) || Date.parse(b.updatedAt || b.createdAt || "") - Date.parse(a.updatedAt || a.createdAt || ""))
      .map<Mention>((ticket) => ({ kind: "ticket", id: ticket.ticketId, label: ticket.externalReference?.number || ticket.ticketId, title: ticket.title, meta: statusMeta(ticket.status).label, keywords: `${ticket.ticketId} ${ticket.pipelineName ?? ""}` }));
    const pipelineMentions = (pipelines.data?.items ?? [])
      .map<Mention>((pipeline) => ({ kind: "pipeline", id: pipeline.pipelineId, label: pipeline.name, meta: platformLabel(pipeline.platform) ?? pipeline.platform, keywords: `${pipeline.platform ?? ""} ${pipeline.pipelineId}` }));
    const tableMentions = search === term.trim() ? (tables.data?.items ?? []).map<Mention>((table) => ({ kind: "table", id: table.id, label: table.id, title: table.name, meta: platformLabel(table.platform) ?? table.platform })) : [];
    const ranked = rankMentions(term, [...ticketMentions, ...pipelineMentions, ...tableMentions]);
    const typed = typedTable(term.trim());
    if (typed && !ranked.some((item) => item.kind === "table" && item.id.toLowerCase() === typed.id.toLowerCase())) ranked.push(typed);
    return ranked;
  }, [term, search, tickets.data, pipelines.data, tables.data]);

  const loading = active && (tickets.isPending || pipelines.isPending || (search.length >= 2 && tables.isFetching));
  return { items, loading };
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

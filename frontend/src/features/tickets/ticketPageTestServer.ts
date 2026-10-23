import type { Ticket } from "@/api/types";
import { assigneeName, isClosed, sourceKey } from "./ticketFields";
import { isDataQualityTicket } from "@/features/overview/overviewSeries";
import { jsonResponse } from "@/test/utils";

/** Turns legacy fixture rows into the server page contract so page tests can exercise the request. */
export function ticketPageTestResponse(path: string, all: Ticket[]): Promise<Response> {
  const params = new URLSearchParams(path.split("?")[1]);
  const from = params.get("from"); const to = params.get("to");
  const inWindow = (ticket: Ticket) => {
    const at = Date.parse(String(ticket.closedAt || ticket.updatedAt || ticket.createdAt || ""));
    return Number.isNaN(at) || ((!from || at >= Date.parse(from)) && (!to || at <= Date.parse(to)));
  };
  const open = all.filter(ticket => !isClosed(ticket));
  const closed = all.filter(ticket => isClosed(ticket) && inWindow(ticket));
  const scope = params.get("scope") || "active";
  const scoped = scope === "closed" ? closed : scope === "all" ? [...open, ...closed] : open;
  const values = (key: string) => params.get(key)?.split(",").map(value => value.toLowerCase().trim()).filter(value => value && value !== "all") || [];
  const selected = (key: string, value: string) => !values(key).length || values(key).includes(value.toLowerCase());
  const appStatus = (ticket: Ticket) => isClosed(ticket) ? "closed" : ticket.appStatus || "open";
  const q = (params.get("q") || "").toLowerCase();
  const filtered = scoped.filter(ticket =>
    selected("priority", String(ticket.priority || "")) && selected("appStatus", appStatus(ticket)) &&
    (selected("assignee", assigneeName(ticket) || "") || (values("assignee").includes("__none") && !assigneeName(ticket))) &&
    selected("source", sourceKey(ticket)) && selected("kind", String(ticket.kind || "")) &&
    (!values("category").length || selected("category", String(ticket.category || "")) || (values("category").includes("data_quality") && isDataQualityTicket(ticket))) &&
    (!params.get("resolved") || Boolean(ticket.resolvedWithAgent)) &&
    (!q || [ticket.ticketId,ticket.externalReference?.number,ticket.title,ticket.description,ticket.pipelineName,ticket.failureSummary,assigneeName(ticket)].some(value => String(value || "").toLowerCase().includes(q)))
  );
  const rank = (ticket: Ticket) => ["critical","high","medium","low"].indexOf(String(ticket.priority || ""));
  const sort = params.get("sort") || "priority"; const dir = params.get("dir") === "desc" ? -1 : 1;
  filtered.sort((a,b) => {
    const value = sort === "updated" ? Date.parse(String(b.updatedAt || b.createdAt)) - Date.parse(String(a.updatedAt || a.createdAt))
      : sort === "priority" ? rank(a) - rank(b)
      : String(sort === "title" ? a.title : sort === "source" ? sourceKey(a) : sort === "assignee" ? assigneeName(a) : appStatus(a)).localeCompare(String(sort === "title" ? b.title : sort === "source" ? sourceKey(b) : sort === "assignee" ? assigneeName(b) : appStatus(b)));
    return value * dir || a.ticketId.localeCompare(b.ticketId);
  });
  const options = {
    priority: [...new Set(scoped.map(ticket => String(ticket.priority || "").toLowerCase()))].filter(Boolean),
    status: [...new Set(scoped.map(appStatus))],
    assignee: [...new Set(scoped.map(ticket => assigneeName(ticket) || ""))].filter(Boolean),
    source: [...new Set(scoped.map(sourceKey))],
  };
  const people = all.flatMap(ticket => [ticket.assignee,ticket.creator,...(ticket.collaborators || [])]).filter(person => person?.id && person.type !== "system");
  const offset = Number(params.get("offset") || 0); const limit = Number(params.get("limit") || 10);
  return jsonResponse({items:filtered.slice(offset,offset+limit),total:filtered.length,meta:{open:open.length,highOpen:open.filter(ticket => ["critical","high"].includes(String(ticket.priority || "").toLowerCase())).length,waitingOnYou:open.filter(ticket => appStatus(ticket) === "waiting_on_you").length,closed:closed.length,resolved:closed.filter(ticket => ticket.resolvedWithAgent).length,scoped:scoped.length,options,people}});
}

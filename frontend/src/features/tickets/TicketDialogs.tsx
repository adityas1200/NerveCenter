import { refreshAfterWrite } from "@/lib/refreshAfterWrite";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { queryKeys } from "@/api/queryKeys";
import { ticketsApi, type CreateTicketRequest, type JiraStatus, type JiraSyncFilters, type ServiceNowStatus, type ServiceNowSyncFilters } from "@/api/tickets";
import type { UserIdentity } from "@/api/types";
import { useMe } from "@/auth/rbac";
import { BrandLogo } from "@/components/ops/BrandLogo";
import { priorityText } from "@/components/ops/PriorityBadge";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch, Textarea, useToast } from "@/components/ui";
import { TICKET_CATEGORIES } from "./ticketFields";
import { Field } from "@/components/ops/Field";
import { FRESH } from "@/api/queryPolicy";

/**
 * The dialogs on the Tickets screen. New ticket asks only for what a person
 * knows: what, how urgent, who. The sync dialogs pull a controlled set from
 * ServiceNow or Jira and show how many would come in before importing.
 */

const UNASSIGNED = "__unassigned";

export function NewTicketDialog({ open, onOpenChange, people }: { open: boolean; onOpenChange: (open: boolean) => void; people: UserIdentity[] }) {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const me = useMe();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("incident");
  const [priority, setPriority] = useState("medium");
  const [assignee, setAssignee] = useState<string>("me");
  const [startTriage, setStartTriage] = useState(true);
  useEffect(() => { if (!open) { setTitle(""); setDescription(""); setCategory("incident"); setPriority("medium"); setAssignee("me"); setStartTriage(true); } }, [open]);

  const options = useMemo(() => {
    const seen = new Map<string, UserIdentity>();
    for (const person of people) if (person?.id && !seen.has(person.id)) seen.set(person.id, person);
    if (me.data?.user?.id) seen.delete(me.data?.user?.id);
    return [...seen.values()].sort((left, right) => String(left.name || left.id).localeCompare(String(right.name || right.id)));
  }, [people, me.data?.user?.id]);

  const create = useMutation({
    mutationFn: () => {
      const who: UserIdentity | null = assignee === "me" && me.data?.user ? { id: me.data?.user?.id, name: me.data?.user?.name } : assignee === UNASSIGNED ? null : options.find((person) => person.id === assignee) ?? null;
      const input: CreateTicketRequest = { title: title.trim(), description: description.trim() || undefined, category, priority, assignee: who, startTriage };
      return ticketsApi.create(input);
    },
    onSuccess: async (ticket) => {
      onOpenChange(false);
      await Promise.all([refreshAfterWrite(queryClient, { queryKey: queryKeys.tickets.all }), refreshAfterWrite(queryClient, { queryKey: queryKeys.overview.all })]);
      toast.success("Ticket created", `${ticket.ticketId} is ready.`);
      navigate(`/tickets/${encodeURIComponent(ticket.ticketId)}`);
    },
    onError: (error) => toast.error("Ticket not created", error instanceof Error ? error.message : "Try again."),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New ticket</DialogTitle>
          <DialogDescription>For work that did not come from a pipeline or a check.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 px-5">
          <Field label="Title" htmlFor="ticket-title"><Input id="ticket-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Give the new analyst access to CPH_DB_PROD" /></Field>
          <Field label="Description" htmlFor="ticket-description"><Textarea id="ticket-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What is needed, for whom, and by when" /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Category" htmlFor="ticket-category">
              <Select value={category} onValueChange={setCategory}><SelectTrigger id="ticket-category"><SelectValue /></SelectTrigger><SelectContent>{TICKET_CATEGORIES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select>
            </Field>
            <Field label="Priority" htmlFor="ticket-priority">
              <Select value={priority} onValueChange={setPriority}><SelectTrigger id="ticket-priority"><SelectValue /></SelectTrigger><SelectContent>{["critical", "high", "medium", "low"].map((value) => <SelectItem key={value} value={value}>{priorityText(value)}</SelectItem>)}</SelectContent></Select>
            </Field>
          </div>
          <Field label="Assign to" htmlFor="ticket-assignee">
            <Select value={assignee} onValueChange={setAssignee}>
              <SelectTrigger id="ticket-assignee"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="me">{me.data?.user?.name ? `${me.data?.user?.name} (me)` : "Me"}</SelectItem>
                <SelectItem value={UNASSIGNED}>Nobody yet</SelectItem>
                {options.map((person) => <SelectItem key={person.id} value={person.id}>{person.name || person.id}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <div className="flex items-center gap-3 text-[13.5px] text-ink-2">
            <Switch id="ticket-triage" checked={startTriage} onCheckedChange={setStartTriage} aria-label="Let Sonic triage it now" />
            <label htmlFor="ticket-triage">Let Sonic triage it now</label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" disabled={!title.trim() || create.isPending} onClick={() => create.mutate()}>{create.isPending ? "Creating…" : "Create ticket"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const STATE_OPTIONS = ["New", "In Progress", "On Hold"] as const;
const PRIORITY_OPTIONS = [{ value: "1", label: "1 - Critical" }, { value: "2", label: "2 - High" }, { value: "3", label: "3 - Moderate" }] as const;
const SINCE_OPTIONS = [{ value: "24", label: "Last 24 hours" }, { value: "168", label: "Last 7 days" }, { value: "720", label: "Last 30 days" }, { value: "0", label: "Any time" }] as const;

export function SyncServiceNowDialog({ open, onOpenChange, status }: { open: boolean; onOpenChange: (open: boolean) => void; status?: ServiceNowStatus }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const groups = useMemo(() => status?.assignmentGroups ?? [], [status?.assignmentGroups]);
  const [group, setGroup] = useState<string>("");
  const [states, setStates] = useState<string[]>(["New", "In Progress"]);
  const [priorities, setPriorities] = useState<string[]>(["1", "2"]);
  const [since, setSince] = useState("168");
  const [tag, setTag] = useState("");
  const [limit, setLimit] = useState("10");
  const [startTriage, setStartTriage] = useState(false);
  useEffect(() => { if (open && !group && groups.length) setGroup(groups[0]); }, [open, group, groups]);

  const filters: ServiceNowSyncFilters = useMemo(() => ({
    assignmentGroup: group || undefined,
    states,
    priorities,
    tag: tag.trim() || undefined,
    updatedSinceHours: Number(since) || undefined,
    limit: Math.max(1, Math.min(2000, Number(limit) || 10)),
    startTriage,
  }), [group, states, priorities, tag, since, limit, startTriage]);

  const preview = useQuery({
    queryKey: queryKeys.serviceNow.preview({ ...filters, startTriage: undefined }),
    queryFn: ({ signal }) => ticketsApi.serviceNow.preview(filters, signal),
    enabled: open && Boolean(status?.ready),
    staleTime: FRESH.short,
    retry: false,
  });

  const sync = useMutation({
    mutationFn: () => ticketsApi.serviceNow.sync(filters),
    onSuccess: async (result) => {
      onOpenChange(false);
      await Promise.all([queryClient.refetchQueries({ queryKey: queryKeys.tickets.all, type: "active" }, { cancelRefetch: false }), refreshAfterWrite(queryClient, { queryKey: queryKeys.overview.all }), refreshAfterWrite(queryClient, { queryKey: queryKeys.serviceNow.all })]);
      toast.success("ServiceNow synced", `${result.synced} ${result.synced === 1 ? "incident" : "incidents"} imported or refreshed.`);
    },
    onError: (error) => toast.error("ServiceNow sync failed", error instanceof Error ? error.message : "Could not load ServiceNow incidents."),
  });

  const toggle = (list: string[], set: (next: string[]) => void, value: string) => set(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><BrandLogo brand="servicenow" className="h-[18px] w-[18px]" />Sync from ServiceNow</DialogTitle>
          <DialogDescription>{status?.instance ? `${status.instance}, ` : ""}pull a controlled set of incidents. Nothing is imported until you confirm.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 px-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Assignment group" htmlFor="sn-group">
              {groups.length ? (
                <Select value={group} onValueChange={setGroup}><SelectTrigger id="sn-group"><SelectValue placeholder="Any group" /></SelectTrigger><SelectContent>{groups.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
              ) : (
                <Input id="sn-group" value={group} onChange={(event) => setGroup(event.target.value)} placeholder="Any group" />
              )}
            </Field>
            <Field label="Updated" htmlFor="sn-since">
              <Select value={since} onValueChange={setSince}><SelectTrigger id="sn-since"><SelectValue /></SelectTrigger><SelectContent>{SINCE_OPTIONS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select>
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <fieldset><legend className="mb-1 block text-[13px] font-medium text-ink-3">State</legend><div className="flex flex-wrap gap-1.5">{STATE_OPTIONS.map((value) => <Chip key={value} on={states.includes(value)} onClick={() => toggle(states, setStates, value)}>{value}</Chip>)}</div></fieldset>
            <fieldset><legend className="mb-1 block text-[13px] font-medium text-ink-3">Priority</legend><div className="flex flex-wrap gap-1.5">{PRIORITY_OPTIONS.map((item) => <Chip key={item.value} on={priorities.includes(item.value)} onClick={() => toggle(priorities, setPriorities, item.value)}>{item.label}</Chip>)}</div></fieldset>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Tag or label" htmlFor="sn-tag"><Input id="sn-tag" value={tag} onChange={(event) => setTag(event.target.value)} placeholder="Optional" /></Field>
            <Field label="Maximum" htmlFor="sn-limit"><Input id="sn-limit" type="number" min={1} max={2000} value={limit} onChange={(event) => setLimit(event.target.value)} /></Field>
          </div>
          <p role="status" className="rounded-lg border border-line bg-surface-subtle px-3 py-2 text-[13.5px] text-ink-3">
            {!status?.ready ? "ServiceNow is not connected." : preview.isPending ? "Checking…" : preview.isError ? "Preview unavailable, import will still apply these filters." : preview.data ? <><span className="font-semibold text-ink-1">{preview.data.total} {preview.data.total === 1 ? "incident matches" : "incidents match"}</span>{preview.data.alreadyImported ? `, ${preview.data.alreadyImported} already in NerveCenter and will be refreshed` : ""}</> : null}
          </p>
          <div className="flex items-center gap-3 text-[13.5px] text-ink-2">
            <Switch id="sn-triage" checked={startTriage} onCheckedChange={setStartTriage} aria-label="Start agent triage on imported tickets" />
            <label htmlFor="sn-triage">Start agent triage on imported tickets</label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" disabled={!status?.ready || sync.isPending || preview.data?.total === 0} onClick={() => sync.mutate()}>{sync.isPending ? "Importing…" : preview.data ? `Import ${Math.min(preview.data.total, filters.limit ?? preview.data.total)}` : "Import"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SyncJiraDialog({ open, onOpenChange, status }: { open: boolean; onOpenChange: (open: boolean) => void; status?: JiraStatus }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [project, setProject] = useState("");
  const [jql, setJql] = useState("");
  const [since, setSince] = useState("168");
  const [limit, setLimit] = useState("25");
  useEffect(() => { if (open) { setProject(status?.project || ""); setJql(status?.defaultJql || ""); setSince("168"); setLimit("25"); } }, [open, status?.project, status?.defaultJql]);

  const filters: JiraSyncFilters = useMemo(() => ({ project: project.trim() || undefined, jql: jql.trim() || undefined, updatedSinceHours: jql.trim() ? undefined : Number(since) || undefined, limit: Math.max(1, Math.min(2000, Number(limit) || 25)) }), [project, jql, since, limit]);
  const preview = useQuery({ queryKey: queryKeys.jira.preview(filters), queryFn: ({ signal }) => ticketsApi.jira.preview(filters, signal), enabled: open && Boolean(status?.ready), staleTime: FRESH.short, retry: false });
  const sync = useMutation({
    mutationFn: () => ticketsApi.jira.sync(filters),
    onSuccess: async (result) => {
      onOpenChange(false);
      await Promise.all([queryClient.refetchQueries({ queryKey: queryKeys.tickets.all, type: "active" }, { cancelRefetch: false }), refreshAfterWrite(queryClient, { queryKey: queryKeys.overview.all }), refreshAfterWrite(queryClient, { queryKey: queryKeys.jira.all })]);
      toast.success("Jira synced", `${result.synced} ${result.synced === 1 ? "issue" : "issues"} imported or refreshed.`);
    },
    onError: (error) => toast.error("Jira sync failed", error instanceof Error ? error.message : "Could not load Jira issues."),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><BrandLogo brand="jira" className="h-[18px] w-[18px]" />Sync from Jira</DialogTitle>
          <DialogDescription>{status?.site ? `${status.site.replace(/^https?:\/\//, "")}, ` : ""}pull open issues into NerveCenter. Nothing is imported until you confirm.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 px-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Project key" htmlFor="jira-project"><Input id="jira-project" value={project} onChange={(event) => setProject(event.target.value.toUpperCase())} placeholder="DATAOPS" disabled={Boolean(jql.trim())} /></Field>
            <Field label="Updated" htmlFor="jira-since">
              <Select value={since} onValueChange={setSince} disabled={Boolean(jql.trim())}><SelectTrigger id="jira-since"><SelectValue /></SelectTrigger><SelectContent>{SINCE_OPTIONS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select>
            </Field>
          </div>
          <Field label="Or a JQL query" htmlFor="jira-jql"><Textarea id="jira-jql" rows={2} className="font-mono text-[13px]" value={jql} onChange={(event) => setJql(event.target.value)} placeholder="project = DATAOPS AND priority in (Highest, High) AND statusCategory != Done" /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Maximum" htmlFor="jira-limit"><Input id="jira-limit" type="number" min={1} max={2000} value={limit} onChange={(event) => setLimit(event.target.value)} /></Field>
          </div>
          <p role="status" className="rounded-lg border border-line bg-surface-subtle px-3 py-2 text-[13.5px] text-ink-3">
            {!status?.ready ? status?.reason || "Jira is not connected." : preview.isPending ? "Checking…" : preview.isError ? (preview.error instanceof Error ? preview.error.message : "Preview unavailable, import will still apply these filters.") : preview.data ? <><span className="font-semibold text-ink-1">{preview.data.total} {preview.data.total === 1 ? "issue matches" : "issues match"}</span>{preview.data.alreadyImported ? `, ${preview.data.alreadyImported} already in NerveCenter and will be refreshed` : ""}</> : null}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" disabled={!status?.ready || sync.isPending || preview.data?.total === 0} onClick={() => sync.mutate()}>{sync.isPending ? "Importing…" : preview.data ? `Import ${Math.min(preview.data.total, filters.limit ?? preview.data.total)}` : "Import"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" aria-pressed={on} onClick={onClick} className={`rounded-full border px-2.5 py-1 text-[13px] transition-colors ${on ? "border-ink-1 bg-ink-1 text-raised" : "border-line bg-raised text-ink-3 hover:border-line-strong"}`}>{children}</button>;
}

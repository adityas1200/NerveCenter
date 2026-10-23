import { refreshAfterWrite } from "@/lib/refreshAfterWrite";
import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { Plus, Search, X } from "lucide-react";
import { adminApi, type AdminUser } from "@/api/admin";
import { projectsApi, UNROUTED, type Project, type ProjectRole } from "@/api/projects";
import { BrandLogo } from "@/components/ops/BrandLogo";
import { OutsidePage } from "@/components/layout/OutsideChrome";
import { Pager } from "@/components/ops/Pager";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Skeleton, Switch, confirmAction, useToast } from "@/components/ui";
import { useIsAdmin, useMe } from "@/auth/rbac";
import { goTo } from "@/lib/appRouterCore";
import { myProjectsKey, useMyProjects } from "@/lib/projectContext";
import { cn } from "@/lib/utils";
import { usePager } from "@/lib/usePager";
import { ProjectArt } from "@/features/home/ProjectCard";
import { PersonPicker } from "@/features/projects/PersonPicker";
import { AddPersonDialog } from "./AddPersonDialog";
import { Segmented } from "@/features/projects/Segmented";

/**
 * The admin console (SPEC-projects-03 FR-20), for app admins only: People (app roles, projects, blocking), Projects
 * (members, open to everyone, renaming, archiving) and Connections (which ones owners may grant).
 * It replaces Settings > Users & roles and Settings > Projects. The server checks every change; this only lays them out.
 */

const TABS = [["people", "People"], ["projects", "Projects"], ["connections", "Connections"]] as const;
type Tab = (typeof TABS)[number][0];
const APP_ROLES = [["viewer", "Viewer"], ["developer", "Developer"], ["admin", "Admin"]] as const;
const PROJECT_ROLES = [["viewer", "Viewer"], ["developer", "Developer"], ["owner", "Owner"]] as const;
const mono = "font-mono text-[11px] font-medium uppercase tracking-[0.06em]";
const errorText = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong");
const KEYS = { users: ["auth", "admin", "users"], projects: ["auth", "admin", "projects"], connections: ["auth", "admin", "connections"] } as const;

export function AdminConsolePage() {
  const admin = useIsAdmin();
  const me = useMe();
  const { tab: raw } = useParams();
  const navigate = useNavigate();
  const tab: Tab = (TABS.find(([id]) => id === raw)?.[0]) ?? "people";
  if (me.data && !admin) return <Navigate to="/" replace />;
  return (
    <OutsidePage crumb="Admin console">
      <div className="mx-auto w-[min(1240px,calc(100vw-48px))] pb-24">
        <h1 className="m-0 mb-6 mt-10 font-display text-[40px] font-bold leading-[1.1] tracking-[-0.03em]">Admin console</h1>
        <Segmented label="Admin console section" value={tab} options={TABS} onChange={(next) => navigate(next === "people" ? "/admin" : `/admin/${next}`)} className="mb-6" />
        <div key={tab} className="page-enter">
          {tab === "people" ? <PeopleTab /> : null}
          {tab === "projects" ? <ProjectsTab /> : null}
          {tab === "connections" ? <ConnectionsTab /> : null}
        </div>
      </div>
    </OutsidePage>
  );
}

/* ------------------------------------------------------------------ shared pieces */

function useAdminProjects() {
  const query = useQuery({ queryKey: KEYS.projects, queryFn: ({ signal }) => projectsApi.list(signal) });
  const projects = (query.data?.items ?? []).filter((project) => project.kind !== UNROUTED);
  return { query, projects };
}

function Tile({ project, size = 22 }: { project: { id: string; color?: Project["color"] }; size?: number }) {
  return <span className="inline-block shrink-0 overflow-hidden rounded-[7px] shadow-[inset_0_0_0_1px_rgb(var(--c-ink-1)/0.06)]" style={{ width: size, height: size }} title={project.id}><ProjectArt project={project} width={18} height={18} className="h-full" /></span>;
}

function Toolbar({ search, onSearch, placeholder, children }: { search: string; onSearch: (value: string) => void; placeholder: string; children?: ReactNode }) {
  return (
    <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
      <label className="flex h-[34px] w-60 items-center gap-2 rounded-[10px] border border-ink-1/[0.12] bg-raised px-3 text-ink-4">
        <Search className="h-4 w-4" aria-hidden="true" />
        <input value={search} onChange={(event) => onSearch(event.target.value)} placeholder={placeholder} aria-label={placeholder} className="min-w-0 flex-1 bg-transparent text-[13.5px] text-ink-1 outline-none placeholder:text-ink-5" />
      </label>
      {children}
    </div>
  );
}

function Drawer({ title, subtitle, art, onClose, children }: { title: string; subtitle: string; art: ReactNode; onClose: () => void; children: ReactNode }) {
  return (
    <aside className="animate-fade-in self-start rounded-[18px] border border-ink-1/[0.08] bg-raised p-5 shadow-pop lg:sticky lg:top-[84px]" aria-label={title}>
      <div className="mb-[18px] flex items-center gap-3">
        {art}
        <div className="min-w-0 flex-1"><b className="block truncate text-[17px] font-semibold">{title}</b><small className="block truncate font-mono text-[11px] text-ink-5">{subtitle}</small></div>
        <button type="button" onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-lg text-ink-4 hover:bg-ink-1/[0.05] hover:text-ink-1"><X className="h-4 w-4" /></button>
      </div>
      {children}
    </aside>
  );
}

function RoleSelect({ value, onChange, label, options = PROJECT_ROLES }: { value: string; onChange: (value: string) => void; label: string; options?: ReadonlyArray<readonly [string, string]> }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className="h-8 w-[124px] text-[12.5px]"><SelectValue /></SelectTrigger>
      <SelectContent>{options.map(([id, text]) => <SelectItem key={id} value={id}>{text}</SelectItem>)}</SelectContent>
    </Select>
  );
}

const rowGrid = "grid w-full items-center gap-3.5 border-t border-ink-1/[0.06] px-4 py-2.5 text-left text-[13.5px] transition-colors first:border-t-0";
const headGrid = `${rowGrid} ${mono} border-t-0 py-2 text-ink-5`;

/* ------------------------------------------------------------------ People */

function PeopleTab() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const self = useMe().data?.user.id;
  const users = useQuery({ queryKey: KEYS.users, queryFn: ({ signal }) => adminApi.listUsers(signal) });
  const { projects } = useAdminProjects();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "admin" | "developer" | "viewer">("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const all = users.data ?? [];
  const rows = all.filter((user) => (filter === "all" || user.role === filter) && (!search.trim() || [user.id, user.name, user.email].some((value) => String(value || "").toLowerCase().includes(search.trim().toLowerCase()))));
  const pager = usePager(rows.length, { resetKey: JSON.stringify({ search: search.trim(), filter }) });
  const current = all.find((user) => user.id === selected) ?? null;
  const count = (role: string) => all.filter((user) => user.role === role).length;
  const byId = (id: string) => projects.find((project) => project.id === id);
  const refresh = () => { void refreshAfterWrite(queryClient, { queryKey: KEYS.users }); void refreshAfterWrite(queryClient, { queryKey: myProjectsKey }); };
  const onError = (error: unknown) => toast.error("Not changed", errorText(error));

  return (
    <div className={cn("grid items-start gap-6", current && "lg:grid-cols-[1fr_430px]")}>
      <div className="min-w-0">
        <Toolbar search={search} onSearch={setSearch} placeholder="Find a person">
          <Segmented label="Show" value={filter} onChange={setFilter} options={[["all", `Everyone ${all.length}`], ["admin", `Admins ${count("admin")}`], ["developer", `Developers ${count("developer")}`], ["viewer", `Viewers ${count("viewer")}`]] as const} />
          <span className="flex-1" />
          <button type="button" onClick={() => setAdding(true)} className="inline-flex h-[34px] items-center gap-1.5 rounded-[10px] bg-ink-1 px-3.5 text-[13px] font-semibold text-surface-base hover:bg-ink-2"><Plus className="h-4 w-4" aria-hidden="true" />Add person</button>
        </Toolbar>
        {adding ? <AddPersonDialog users={all} onClose={() => setAdding(false)} onAdded={() => { setAdding(false); refresh(); }} /> : null}
        <div className="overflow-hidden rounded-2xl border border-line bg-raised shadow-card">
          <div className={cn(headGrid, "grid-cols-[1.6fr_110px_1fr_90px]")}><span>Person</span><span>App role</span><span>Projects</span><span>Status</span></div>
          {users.isLoading ? <div className="p-4"><Skeleton className="h-4 w-60" /></div> : null}
          {users.isError ? <p role="alert" className="p-4 text-[13.5px] text-rose-700">{errorText(users.error)}</p> : null}
          {users.data && !rows.length ? <p className="p-4 text-[13.5px] text-ink-4">No one matches</p> : null}
          {pager.slice(rows).map((user) => (
            <button key={user.id} type="button" onClick={() => setSelected(user.id)} aria-current={selected === user.id ? "true" : undefined} className={cn(rowGrid, "grid-cols-[1.6fr_110px_1fr_90px] hover:bg-ink-1/[0.025]", selected === user.id && "bg-brand/[0.06] shadow-[inset_2px_0_0_rgb(var(--c-brand))]")}>
              <span className="min-w-0"><b className="block truncate font-semibold">{user.name || user.id}</b><small className="block truncate text-[11.5px] text-ink-5">{user.email || user.id}</small></span>
              <span>{user.role === "admin" ? <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[11.5px] font-semibold text-brand">Admin</span> : <span className="text-ink-3">{user.role === "developer" ? "Developer" : "Viewer"}</span>}</span>
              <span className="flex flex-wrap items-center gap-1">{(user.projects ?? []).map((item) => { const project = byId(item.projectId); return project ? <Tile key={item.projectId} project={project} /> : null; })}{!(user.projects ?? []).length ? <span className="text-ink-5">None</span> : null}</span>
              <span className={user.blocked ? "font-medium text-rose-700" : "text-ink-4"}>{user.blocked ? "Blocked" : "Active"}</span>
            </button>
          ))}
          <Pager {...pager.pagerProps} noun="people" />
        </div>
      </div>
      {current ? <PersonDrawer key={current.id} user={current} self={current.id === self} projects={projects} onClose={() => setSelected(null)} refresh={refresh} onError={onError} /> : null}
    </div>
  );
}

function PersonDrawer({ user, self, projects, onClose, refresh, onError }: { user: AdminUser; self: boolean; projects: Project[]; onClose: () => void; refresh: () => void; onError: (error: unknown) => void }) {
  const [addTo, setAddTo] = useState("");
  const [addRole, setAddRole] = useState<ProjectRole>("viewer");
  const memberships = user.projects ?? [];
  const setRole = useMutation({ mutationFn: (role: "admin" | "developer" | "viewer") => adminApi.setRole(user.id, role), onSuccess: refresh, onError });
  const setProjectRole = useMutation({ mutationFn: ({ projectId, role }: { projectId: string; role: ProjectRole }) => projectsApi.setRole(projectId, user.id, role), onSuccess: refresh, onError });
  const removeFrom = useMutation({ mutationFn: (projectId: string) => projectsApi.removeMember(projectId, user.id), onSuccess: refresh, onError });
  const add = useMutation({ mutationFn: () => projectsApi.addMember(addTo, user.id, addRole), onSuccess: () => { setAddTo(""); refresh(); }, onError });
  const block = useMutation({ mutationFn: () => (user.blocked ? adminApi.unblock(user.id) : adminApi.block(user.id)), onSuccess: refresh, onError });
  const addable = projects.filter((project) => !project.archivedAt && !memberships.some((item) => item.projectId === project.id));
  return (
    <Drawer title={user.name || user.id} subtitle={user.email || user.id} onClose={onClose} art={<span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-ink-1 text-[14px] font-semibold text-raised">{(user.name || user.id).split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span>}>
      <div className="mb-5">
        <span className={`${mono} mb-2 block text-ink-4`}>App role</span>
        <Segmented label="App role" wide value={user.role} options={APP_ROLES} onChange={(role) => { if (!self) setRole.mutate(role); }} />
        {self ? <p className="mt-1.5 text-[12.5px] text-ink-5">You cannot change your own role</p> : null}
      </div>
      <div className="mb-5">
        <span className={`${mono} mb-2 block text-ink-4`}>Projects</span>
        <div className="mb-2.5 grid gap-1">
          {memberships.map((item) => {
            const project = projects.find((candidate) => candidate.id === item.projectId);
            return (
              <div key={item.projectId} className="flex items-center gap-2.5 rounded-[10px] p-1.5 hover:bg-ink-1/[0.03]">
                {project ? <Tile project={project} size={28} /> : null}
                <b className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{project?.name ?? item.projectId}</b>
                <RoleSelect label={`Role in ${project?.name ?? item.projectId}`} value={item.role} onChange={(role) => setProjectRole.mutate({ projectId: item.projectId, role: role as ProjectRole })} />
                <button type="button" aria-label={`Remove from ${project?.name ?? item.projectId}`} onClick={() => removeFrom.mutate(item.projectId)} className="grid h-7 w-7 place-items-center rounded-lg text-ink-4 hover:bg-ink-1/[0.05] hover:text-ink-1"><X className="h-3.5 w-3.5" /></button>
              </div>
            );
          })}
          {!memberships.length ? <p className="px-1.5 py-1 text-[13px] text-ink-5">Not in any project</p> : null}
        </div>
        {addable.length ? (
          <div className="flex items-center gap-2">
            <Select value={addTo} onValueChange={setAddTo}>
              <SelectTrigger aria-label="Add to project" className="h-[34px] flex-1 text-[13px]"><SelectValue placeholder="Add to a project" /></SelectTrigger>
              <SelectContent>{addable.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectContent>
            </Select>
            <RoleSelect label="Role in that project" value={addRole} onChange={(role) => setAddRole(role as ProjectRole)} />
            <button type="button" disabled={!addTo || add.isPending} onClick={() => add.mutate()} className="h-[34px] rounded-[10px] border border-line-strong bg-raised px-3 text-[13px] font-semibold shadow-card disabled:opacity-40">Add</button>
          </div>
        ) : null}
      </div>
      {!self ? <button type="button" onClick={() => { void confirmAction({ title: user.blocked ? `Unblock ${user.name || user.id}?` : `Block ${user.name || user.id}?`, description: user.blocked ? "They can sign in again." : "They lose access to every project at once.", confirmLabel: user.blocked ? "Unblock" : "Block", destructive: !user.blocked }).then((ok) => { if (ok) block.mutate(); }); }} className="h-[30px] rounded-lg px-1.5 text-[13px] font-semibold text-rose-700 hover:bg-rose-50">{user.blocked ? "Unblock" : "Block"}</button> : null}
    </Drawer>
  );
}

/* ------------------------------------------------------------------ Projects */

function ProjectsTab() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { query, projects } = useAdminProjects();
  const unrouted = useMyProjects().data?.unrouted ?? 0;
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const members = useQueries({ queries: projects.map((project) => ({ queryKey: [...KEYS.projects, project.id, "members"], queryFn: ({ signal }) => projectsApi.members(project.id, signal) })) });
  const membersOf = useMemo(() => new Map(projects.map((project, index) => [project.id, members[index]?.data?.items ?? []])), [projects, members]);
  const rows = projects.filter((project) => !search.trim() || `${project.name} ${project.id}`.toLowerCase().includes(search.trim().toLowerCase()));
  const pager = usePager(rows.length, { resetKey: search.trim() });
  const current = projects.find((project) => project.id === selected) ?? null;
  const refresh = () => { void refreshAfterWrite(queryClient, { queryKey: KEYS.projects }); void refreshAfterWrite(queryClient, { queryKey: myProjectsKey }); void refreshAfterWrite(queryClient, { queryKey: KEYS.users }); };
  const onError = (error: unknown) => toast.error("Not changed", errorText(error));
  const setOpen = useMutation({ mutationFn: ({ id, open }: { id: string; open: boolean }) => projectsApi.update(id, { open }), onSuccess: refresh, onError });

  return (
    <div className={cn("grid items-start gap-6", current && "lg:grid-cols-[1fr_430px]")}>
      <div className="min-w-0">
        <Toolbar search={search} onSearch={setSearch} placeholder="Find a project">
          <span className="flex-1" />
          {unrouted ? <button type="button" onClick={() => goTo("/p/unrouted/tickets")} className="h-[34px] rounded-[10px] px-3 text-[13px] font-medium text-ink-3 hover:bg-ink-1/[0.05]">Unrouted <span className="ml-1 tabular-nums text-amber-700">{unrouted}</span></button> : null}
          <button type="button" onClick={() => goTo("/new")} className="inline-flex h-[34px] items-center gap-1.5 rounded-[10px] bg-ink-1 px-3.5 text-[13px] font-semibold text-surface-base hover:bg-ink-2"><Plus className="h-4 w-4" aria-hidden="true" />New project</button>
        </Toolbar>
        <div className="overflow-hidden rounded-2xl border border-line bg-raised shadow-card">
          <div className={cn(headGrid, "grid-cols-[1.6fr_120px_70px_64px_90px]")}><span>Project</span><span>Owners</span><span>People</span><span>Open</span><span>Created</span></div>
          {query.isLoading ? <div className="p-4"><Skeleton className="h-4 w-60" /></div> : null}
          {query.isError ? <p role="alert" className="p-4 text-[13.5px] text-rose-700">{errorText(query.error)}</p> : null}
          {pager.slice(rows).map((project) => {
            const people = membersOf.get(project.id) ?? [];
            const owners = people.filter((member) => member.role === "owner");
            return (
              <div key={project.id} role="button" tabIndex={0} onClick={(event) => { if (!(event.target as HTMLElement).closest('[role="switch"]')) setSelected(project.id); }} onKeyDown={(event) => { if (event.key === "Enter" && event.target === event.currentTarget) setSelected(project.id); }} aria-current={selected === project.id ? "true" : undefined} className={cn(rowGrid, "cursor-pointer grid-cols-[1.6fr_120px_70px_64px_90px] hover:bg-ink-1/[0.025]", selected === project.id && "bg-brand/[0.06] shadow-[inset_2px_0_0_rgb(var(--c-brand))]")}>
                <span className="flex min-w-0 items-center gap-2.5"><Tile project={project} size={30} /><span className="min-w-0"><b className="block truncate font-semibold">{project.name}</b><small className="block truncate font-mono text-[11px] text-ink-5">{project.id}{project.archivedAt ? " · archived" : ""}</small></span></span>
                <span className="truncate text-ink-3">{owners.map((owner) => owner.name || owner.userId).join(", ") || <span className="text-ink-5">Admins</span>}</span>
                <span className="tabular-nums text-ink-3">{people.length}</span>
                <span><Switch checked={Boolean(project.open)} disabled={Boolean(project.archivedAt) || setOpen.isPending} onCheckedChange={(open) => setOpen.mutate({ id: project.id, open })} aria-label={`Open ${project.name} to everyone`} /></span>
                <span className="text-ink-4">{new Date(project.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
              </div>
            );
          })}
          <Pager {...pager.pagerProps} noun="projects" />
        </div>
      </div>
      {current ? <ProjectDrawer key={current.id} project={current} members={membersOf.get(current.id) ?? []} onClose={() => setSelected(null)} refresh={refresh} onError={onError} /> : null}
    </div>
  );
}

function ProjectDrawer({ project, members, onClose, refresh, onError }: { project: Project; members: Array<{ userId: string; role: ProjectRole; name?: string }>; onClose: () => void; refresh: () => void; onError: (error: unknown) => void }) {
  const [name, setName] = useState(project.name);
  const [adding, setAdding] = useState<ProjectRole>("viewer");
  const setOpen = useMutation({ mutationFn: (open: boolean) => projectsApi.update(project.id, { open }), onSuccess: refresh, onError });
  const rename = useMutation({ mutationFn: () => projectsApi.rename(project.id, name.trim()), onSuccess: refresh, onError });
  const setRole = useMutation({ mutationFn: ({ userId, role }: { userId: string; role: ProjectRole }) => projectsApi.setRole(project.id, userId, role), onSuccess: refresh, onError });
  const remove = useMutation({ mutationFn: (userId: string) => projectsApi.removeMember(project.id, userId), onSuccess: refresh, onError });
  const add = useMutation({ mutationFn: (userId: string) => projectsApi.addMember(project.id, userId, adding), onSuccess: refresh, onError });
  const archive = useMutation({ mutationFn: () => projectsApi.setArchived(project.id, !project.archivedAt), onSuccess: refresh, onError });
  return (
    <Drawer title={project.name} subtitle={project.id} onClose={onClose} art={<Tile project={project} size={44} />}>
      <div className="mb-5 flex items-center gap-3 rounded-xl bg-ink-1/[0.035] px-3.5 py-3">
        <span className="flex-1"><b className="block text-[13.5px] font-semibold">Open to everyone</b><small className="text-[12.5px] text-ink-4">Anyone signed in can view it</small></span>
        <Switch checked={Boolean(project.open)} disabled={Boolean(project.archivedAt)} onCheckedChange={(open) => setOpen.mutate(open)} aria-label="Open to everyone" />
      </div>
      <form className="mb-5 flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); if (name.trim() && name.trim() !== project.name) rename.mutate(); }}>
        <label className="flex-1"><span className={`${mono} mb-2 block text-ink-4`}>Name</span><input value={name} onChange={(event) => setName(event.target.value)} className="h-[34px] w-full rounded-[10px] border border-ink-1/[0.12] bg-raised px-3 text-[13.5px] outline-none focus:border-brand" /></label>
        <button type="submit" disabled={!name.trim() || name.trim() === project.name || rename.isPending} className="h-[34px] rounded-[10px] border border-line-strong bg-raised px-3 text-[13px] font-semibold shadow-card disabled:opacity-40">Rename</button>
      </form>
      <div className="mb-5">
        <span className={`${mono} mb-2 block text-ink-4`}>Members</span>
        <div className="mb-2.5 grid gap-1">
          {members.map((member) => (
            <div key={member.userId} className="flex items-center gap-2.5 rounded-[10px] p-1.5 hover:bg-ink-1/[0.03]">
              <b className="min-w-0 flex-1 truncate text-[13.5px] font-medium" title={member.userId}>{member.name || member.userId}</b>
              <RoleSelect label={`Role of ${member.name || member.userId}`} value={member.role} onChange={(role) => setRole.mutate({ userId: member.userId, role: role as ProjectRole })} />
              <button type="button" aria-label={`Remove ${member.name || member.userId}`} onClick={() => remove.mutate(member.userId)} className="grid h-7 w-7 place-items-center rounded-lg text-ink-4 hover:bg-ink-1/[0.05] hover:text-ink-1"><X className="h-3.5 w-3.5" /></button>
            </div>
          ))}
          {!members.length ? <p className="px-1.5 py-1 text-[13px] text-ink-5">No members. App admins can always open it.</p> : null}
        </div>
        <div className="flex items-center gap-2">
          <PersonPicker className="flex-1" inputClassName="h-[34px] rounded-[10px]" placeholder="Add a person" exclude={members.map((member) => member.userId)} onPick={(person) => add.mutate(person.id)} />
          <RoleSelect label="Role for the next person" value={adding} onChange={(role) => setAdding(role as ProjectRole)} />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => goTo(`/p/${project.id}/settings`)} className="h-[30px] rounded-lg border border-line-strong bg-raised px-3 text-[12.5px] font-semibold shadow-card">Open settings</button>
        <span className="flex-1" />
        <button type="button" onClick={() => { void confirmAction({ title: project.archivedAt ? `Unarchive ${project.name}?` : `Archive ${project.name}?`, description: project.archivedAt ? "It becomes writable again." : "It becomes read-only for everyone. Nothing is deleted.", confirmLabel: project.archivedAt ? "Unarchive" : "Archive", destructive: !project.archivedAt }).then((ok) => { if (ok) archive.mutate(); }); }} className="h-[30px] rounded-lg px-1.5 text-[13px] font-semibold text-rose-700 hover:bg-rose-50">{project.archivedAt ? "Unarchive" : "Archive"}</button>
      </div>
    </Drawer>
  );
}

/* ------------------------------------------------------------------ Connections */

function ConnectionsTab() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const connections = useQuery({ queryKey: KEYS.connections, queryFn: ({ signal }) => adminApi.connections(signal) });
  const { projects } = useAdminProjects();
  const grants = useQueries({ queries: projects.map((project) => ({ queryKey: [...KEYS.projects, project.id, "grants"], queryFn: ({ signal }) => projectsApi.grants(project.id, signal) })) });
  const usedBy = (id: string) => projects.filter((project, index) => grants[index]?.data?.items.some((grant) => grant.resourceType === "connection" && grant.resourceId === id));
  const [search, setSearch] = useState("");
  const share = useMutation({ mutationFn: ({ id, value }: { id: string; value: boolean }) => adminApi.setShareable(id, value), onSuccess: () => void refreshAfterWrite(queryClient, { queryKey: KEYS.connections }), onError: (error) => toast.error("Not changed", errorText(error)) });
  const rows = (connections.data ?? []).filter((item) => !search.trim() || `${item.name} ${item.id} ${item.provider}`.toLowerCase().includes(search.trim().toLowerCase()));
  const pager = usePager(rows.length, { resetKey: search.trim() });
  return (
    <div>
      <Toolbar search={search} onSearch={setSearch} placeholder="Find a connection" />
      <div className="overflow-hidden rounded-2xl border border-line bg-raised shadow-card">
        <div className={cn(headGrid, "grid-cols-[1.6fr_1fr_140px]")}><span>Connection</span><span>Used by</span><span>Owners can grant</span></div>
        {connections.isLoading ? <div className="p-4"><Skeleton className="h-4 w-60" /></div> : null}
        {connections.isError ? <p role="alert" className="p-4 text-[13.5px] text-rose-700">{errorText(connections.error)}</p> : null}
        {connections.data && !rows.length ? <p className="p-4 text-[13.5px] text-ink-4">No connections</p> : null}
        {pager.slice(rows).map((item) => (
          <div key={item.id} className={cn(rowGrid, "grid-cols-[1.6fr_1fr_140px]")}>
            <span className="flex min-w-0 items-center gap-2.5"><span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] bg-ink-1/[0.04]"><BrandLogo brand={item.provider} className="h-[18px] w-[18px]" /></span><span className="min-w-0"><b className="block truncate font-semibold">{item.name}</b><small className="block truncate font-mono text-[11px] text-ink-5">{item.id}</small></span></span>
            <span className="flex flex-wrap items-center gap-1">{usedBy(item.id).map((project) => <Tile key={project.id} project={project} />)}{!usedBy(item.id).length ? <span className="text-ink-5">No project</span> : null}</span>
            <span><Switch checked={Boolean(item.projectAdminsMayGrant)} disabled={share.isPending} onCheckedChange={(value) => share.mutate({ id: item.id, value })} aria-label={`Owners can grant ${item.name}`} /></span>
          </div>
        ))}
        <Pager {...pager.pagerProps} noun="connections" />
      </div>
    </div>
  );
}

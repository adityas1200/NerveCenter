import { refreshAfterWrite } from "@/lib/refreshAfterWrite";
import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import { BookOpen, Check, Puzzle, X } from "lucide-react";
import { FILTER_FIELD, PROJECT_COLORS, projectsApi, ROLE_LABEL, type Autonomy, type GrantType, type NewProjectInput, type Person, type ProjectColor, type ProjectRole } from "@/api/projects";
import { BrandLogo } from "@/components/ops/BrandLogo";
import { OutsidePage } from "@/components/layout/OutsideChrome";
import { Switch } from "@/components/ui";
import { useMe } from "@/auth/rbac";
import { goTo } from "@/lib/appRouterCore";
import { myProjectsKey, useMyProjects } from "@/lib/projectContext";
import { getCurrentUser } from "@/lib/user";
import { cn } from "@/lib/utils";
import { COLOR_INK } from "@/features/home/art/dither";
import { ProjectArt } from "@/features/home/ProjectCard";
import { FieldLabel, Segmented } from "./Segmented";
import { PersonPicker } from "./PersonPicker";
import { FRESH } from "@/api/queryPolicy";
import { queryKeys } from "@/api/queryKeys";

/**
 * New project (SPEC-projects-03 FR-18, FR-19): five steps, Basics, Sources, Knowledge, Sonic and People, and one call that
 * creates the project with all of it. "Create now" works from any step once there is a name. The card on the right is the
 * card Home will show, and it changes as you type. Viewers are sent home: they cannot create projects.
 */

const STEPS = ["Basics", "Sources", "Knowledge", "Sonic", "People"] as const;
const MODELS = [["sonnet", "Sonnet"], ["opus", "Opus"], ["fable", "Fable"]] as const;
const AUTONOMY = [["read", "Only read"], ["ask", "Act after approval"], ["dev", "Act in dev"]] as const;
const ROLES = [["viewer", "Viewer"], ["developer", "Developer"], ["owner", "Owner"]] as const;
type Model = (typeof MODELS)[number][0];

const slugFrom = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
const errorText = (error: unknown) => (error instanceof Error ? error.message : "The project could not be created");
const field = "h-11 w-full rounded-xl border border-ink-1/[0.12] bg-raised px-3.5 text-[15px] text-ink-1 outline-none transition-[border-color,box-shadow] placeholder:text-ink-5 focus:border-brand focus:shadow-[0_0_0_4px_rgb(var(--c-brand)/0.14)]";

export function NewProjectPage() {
  const me = useMe().data;
  const appRole = me?.appRole ?? me?.role;
  const admin = appRole === "admin";
  const queryClient = useQueryClient();
  const mine = useMyProjects().data;
  const grantable = useQuery({ queryKey: queryKeys.auth.grantableNew, queryFn: ({ signal }) => projectsApi.grantableForNew(signal), enabled: appRole === "admin" || appRole === "developer", staleTime: FRESH.medium });
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [idTouched, setIdTouched] = useState(false);
  const [color, setColor] = useState<ProjectColor>("teal");
  const [description, setDescription] = useState("");
  const [copyFrom, setCopyFrom] = useState("");
  const [grants, setGrants] = useState<Record<string, { type: GrantType; filter: string; provider?: string }>>({});
  const [model, setModel] = useState<Model>("sonnet");
  const [autonomy, setAutonomy] = useState<Autonomy>("ask");
  const [people, setPeople] = useState<Array<Person & { role: ProjectRole }>>([]);
  const [adding, setAdding] = useState<ProjectRole>("developer");
  const [open, setOpen] = useState(false);
  const projectId = idTouched ? id : slugFrom(name);
  const copyChoices = (mine?.items ?? []).filter((item) => item.role === "owner" || (admin && item.role !== "open"));
  const self = getCurrentUser();

  const input = useMemo<NewProjectInput>(() => ({
    id: projectId,
    name: name.trim(),
    description: description.trim() || undefined,
    color,
    ...(admin && open ? { open: true } : {}),
    ...(copyFrom ? { copyFrom } : {}),
    grants: Object.entries(grants).map(([key, grant]) => {
      const resourceId = key.slice(key.indexOf(":") + 1);
      const filter = grant.provider ? FILTER_FIELD[grant.provider] : undefined;
      const values = grant.filter.split(",").map((value) => value.trim()).filter(Boolean);
      return { resourceType: grant.type, resourceId, ...(filter && values.length ? { scope: { [filter.field]: values } } : {}) };
    }),
    members: people.map((person) => ({ userId: person.id, role: person.role })),
    settings: { model, autonomy },
  }), [projectId, name, description, color, admin, open, copyFrom, grants, people, model, autonomy]);

  const create = useMutation({
    mutationFn: () => projectsApi.create(input),
    onSuccess: async (project) => { await refreshAfterWrite(queryClient, { queryKey: myProjectsKey }); goTo(`/p/${project.id}`); },
  });

  if (me && appRole !== "admin" && appRole !== "developer") return <Navigate to="/" replace />;
  const ready = Boolean(name.trim()) && /^[a-z0-9][a-z0-9-]{1,31}$/.test(projectId);
  const last = step === STEPS.length - 1;
  const toggleGrant = (type: GrantType, resourceId: string, provider?: string) => setGrants((current) => {
    const key = `${type}:${resourceId}`; const next = { ...current };
    if (next[key]) delete next[key]; else next[key] = { type, filter: "", provider };
    return next;
  });

  return (
    <OutsidePage crumb="New project">
      <div className="mx-auto grid w-[min(1240px,calc(100vw-48px))] gap-12 pb-24 pt-10 lg:grid-cols-[560px_1fr] lg:gap-20">
        <form className="min-w-0" onSubmit={(event) => event.preventDefault()}>
          <h1 className="m-0 mb-7 font-display text-[40px] font-bold leading-[1.1] tracking-[-0.03em]">New project</h1>
          <ol className="mb-8 flex flex-wrap gap-1 p-0" aria-label="Steps">
            {STEPS.map((label, index) => (
              <li key={label} className="list-none">
                <button type="button" onClick={() => setStep(index)} disabled={!name.trim() && index > 0} aria-current={step === index ? "step" : undefined}
                  className={cn("inline-flex h-8 items-center gap-2 rounded-[9px] px-3 pl-2 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45",
                    step === index ? "bg-elevated text-ink-1 shadow-[0_1px_2px_rgb(0_0_0/0.08),0_0_0_1px_rgb(var(--c-ink-1)/0.06)]" : index < step ? "text-ink-2 hover:bg-ink-1/[0.05]" : "text-ink-4 hover:bg-ink-1/[0.05]")}>
                  <span className={cn("font-mono text-[11px]", step === index ? "text-brand" : "text-ink-5")}>{String(index + 1).padStart(2, "0")}</span>{label}
                </button>
              </li>
            ))}
          </ol>

          <div key={step} className="page-enter min-h-[330px]">
            {step === 0 ? (
              <>
                <div className="mb-6"><FieldLabel htmlFor="project-name">Name</FieldLabel><input id="project-name" className={cn(field, "h-[58px] text-[22px] font-medium tracking-[-0.01em]")} placeholder="Market Mix Modelling" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} autoComplete="off" /></div>
                <div className="mb-6 grid gap-6 sm:grid-cols-[200px_1fr]">
                  <div><FieldLabel htmlFor="project-id">ID</FieldLabel><input id="project-id" className={cn(field, "font-mono text-[14px]")} placeholder="market-mix" value={projectId} onChange={(event) => { setIdTouched(true); setId(slugFrom(event.target.value)); }} /></div>
                  <div>
                    <FieldLabel>Colour</FieldLabel>
                    <div role="radiogroup" aria-label="Colour" className="flex h-11 items-center gap-2.5">
                      {PROJECT_COLORS.map((option) => <button key={option} type="button" role="radio" aria-checked={color === option} aria-label={option} onClick={() => setColor(option)} className={cn("h-[26px] w-[26px] rounded-full transition-transform hover:scale-110", color === option && "ring-2 ring-ink-1 ring-offset-[3px] ring-offset-surface-base")} style={{ background: COLOR_INK[option] }} />)}
                    </div>
                  </div>
                </div>
                <div className="mb-6"><FieldLabel htmlFor="project-description">Description</FieldLabel><input id="project-description" className={field} placeholder="Optional" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={400} /></div>
                <div className="mb-6">
                  <FieldLabel htmlFor="copy-from">Start from</FieldLabel>
                  <select id="copy-from" className={cn(field, "text-[14px]")} value={copyFrom} onChange={(event) => setCopyFrom(event.target.value)}>
                    <option value="">Blank</option>
                    {copyChoices.map((item) => <option key={item.id} value={item.id}>Settings of {item.name}</option>)}
                  </select>
                </div>
              </>
            ) : null}

            {step === 1 ? (
              <div className="mb-6">
                <FieldLabel>Connections</FieldLabel>
                {grantable.data && !grantable.data.connections.length ? <p className="text-[14px] text-ink-4">No connections in the library yet</p> : null}
                <div className="grid gap-2">
                  {grantable.data?.connections.map((connection) => {
                    const key = `connection:${connection.id}`; const on = Boolean(grants[key]);
                    const allowed = admin || connection.projectAdminsMayGrant;
                    const filter = FILTER_FIELD[connection.provider];
                    return (
                      <div key={connection.id} className={cn("rounded-[13px] border bg-raised px-3 py-2.5 transition-[border-color,box-shadow]", on ? "border-brand shadow-[0_0_0_3px_rgb(var(--c-brand)/0.12)]" : "border-ink-1/10", !allowed && "bg-transparent opacity-55")}>
                        <div className="flex items-center gap-3">
                          <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] bg-ink-1/[0.04]"><BrandLogo brand={connection.provider} className="h-[18px] w-[18px]" /></span>
                          <span className="min-w-0 flex-1"><b className="block truncate text-[14px] font-semibold">{connection.name}</b><small className="block truncate font-mono text-[11px] text-ink-5">{connection.provider}</small></span>
                          {allowed ? <Switch checked={on} onCheckedChange={() => toggleGrant("connection", connection.id, connection.provider)} aria-label={`Use ${connection.name}`} /> : <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-5">Ask an admin</span>}
                        </div>
                        {on && filter ? (
                          <label className="mt-2.5 grid items-center gap-3 border-t border-ink-1/[0.07] pt-2.5 sm:grid-cols-[170px_1fr]">
                            <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-4">{filter.label}</span>
                            <input className={cn(field, "h-9 rounded-[10px] text-[14px]")} placeholder="Comma separated" value={grants[key].filter} onChange={(event) => setGrants((current) => ({ ...current, [key]: { ...current[key], filter: event.target.value } }))} />
                          </label>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {step === 2 ? (
              <>
                <ChipGroup label="Knowledge" empty="No knowledge bases in the library yet" items={grantable.data?.knowledge ?? []} icon={<BookOpen className="h-3.5 w-3.5" aria-hidden="true" />} isOn={(item) => Boolean(grants[`knowledge:${item}`])} onToggle={(item) => toggleGrant("knowledge", item)} />
                <ChipGroup label="Skills" empty="No shared skills in the library yet" items={grantable.data?.skills ?? []} icon={<Puzzle className="h-3.5 w-3.5" aria-hidden="true" />} isOn={(item) => Boolean(grants[`skill:${item}`])} onToggle={(item) => toggleGrant("skill", item)} />
              </>
            ) : null}

            {step === 3 ? (
              <>
                <div className="mb-6"><FieldLabel>Model</FieldLabel><Segmented label="Model" wide value={model} options={MODELS} onChange={setModel} /></div>
                <div className="mb-6"><FieldLabel>Sonic may</FieldLabel><Segmented label="Sonic may" wide value={autonomy} options={AUTONOMY} onChange={setAutonomy} /></div>
              </>
            ) : null}

            {step === 4 ? (
              <>
                <div className="mb-6">
                  <FieldLabel>People</FieldLabel>
                  <div className="flex flex-wrap gap-2">
                    <PersonPicker className="min-w-[220px] flex-1" placeholder="Name or email" exclude={people.map((person) => person.id)} onPick={(person) => setPeople((current) => [...current, { ...person, role: adding }])} />
                    <Segmented label="Role for the next person" value={adding} options={ROLES} onChange={setAdding} className="h-11 items-center" />
                  </div>
                  <ul className="mt-3 flex flex-wrap gap-2 p-0">
                    <li className="flex list-none items-center gap-2 rounded-full border border-ink-1/[0.08] bg-raised py-1 pl-3 pr-3"><b className="text-[13px] font-medium">{self.name}</b><span className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink-4">Owner</span></li>
                    {people.map((person) => (
                      <li key={person.id} className="flex list-none items-center gap-2 rounded-full border border-ink-1/[0.08] bg-raised py-1 pl-3 pr-1.5">
                        <b className="text-[13px] font-medium">{person.name}</b><span className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink-4">{ROLE_LABEL[person.role]}</span>
                        <button type="button" aria-label={`Remove ${person.name}`} onClick={() => setPeople((current) => current.filter((item) => item.id !== person.id))} className="grid h-5 w-5 place-items-center rounded-full text-ink-4 hover:bg-ink-1/[0.06] hover:text-ink-1"><X className="h-3 w-3" /></button>
                      </li>
                    ))}
                  </ul>
                </div>
                {admin ? (
                  <div className="flex items-center gap-3 rounded-xl bg-ink-1/[0.035] px-3.5 py-3">
                    <span className="flex-1"><b className="block text-[13.5px] font-semibold">Open to everyone</b><small className="text-[12.5px] text-ink-4">Anyone signed in can view it</small></span>
                    <Switch checked={open} onCheckedChange={setOpen} aria-label="Open to everyone" />
                  </div>
                ) : null}
              </>
            ) : null}
          </div>

          {create.isError ? <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13.5px] text-rose-800">{errorText(create.error)}</p> : null}
          <div className="mt-9 flex items-center gap-2.5">
            {step ? <button type="button" onClick={() => setStep(step - 1)} className="h-[42px] rounded-xl px-[18px] text-[14px] font-semibold text-ink-2 hover:bg-ink-1/[0.05]">Back</button> : <button type="button" onClick={() => goTo("/")} className="h-[42px] rounded-xl px-[18px] text-[14px] font-semibold text-ink-2 hover:bg-ink-1/[0.05]">Cancel</button>}
            <span className="flex-1" />
            {!last ? <button type="button" onClick={() => create.mutate()} disabled={!ready || create.isPending} className="h-[42px] rounded-xl border border-line-strong bg-raised px-[18px] text-[14px] font-semibold text-ink-1 shadow-card transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40">Create now</button> : null}
            <button type="button" onClick={last ? () => create.mutate() : () => setStep(step + 1)} disabled={!ready || create.isPending} className="h-[42px] rounded-xl bg-ink-1 px-[18px] text-[14px] font-semibold text-surface-base transition-colors hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-40">{last ? (create.isPending ? "Creating" : "Create project") : "Next"}</button>
          </div>
        </form>

        <aside className="hidden lg:block lg:sticky lg:top-[110px] lg:self-start lg:pt-[112px]" aria-label="Preview">
          <div className="overflow-hidden rounded-[18px] border border-ink-1/[0.08] bg-raised shadow-pop">
            <ProjectArt project={{ id: projectId || "draft", color }} width={252} height={122} className="h-[300px]" />
            <div className="flex items-baseline justify-between gap-3 px-[18px] pb-[18px] pt-4">
              <b className="truncate text-[20px] font-semibold tracking-[-0.01em]">{name.trim() || "Untitled"}</b>
              <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-4">Owner</span>
            </div>
          </div>
        </aside>
      </div>
    </OutsidePage>
  );
}

function ChipGroup({ label, empty, items, icon, isOn, onToggle }: { label: string; empty: string; items: Array<{ id: string; name: string }>; icon: ReactNode; isOn: (id: string) => boolean; onToggle: (id: string) => void }) {
  return (
    <div className="mb-6">
      <FieldLabel>{label}</FieldLabel>
      {!items.length ? <p className="text-[14px] text-ink-4">{empty}</p> : null}
      <div className="flex flex-wrap gap-2">
        {items.map((item) => {
          const on = isOn(item.id);
          return (
            <button key={item.id} type="button" aria-pressed={on} onClick={() => onToggle(item.id)} className={cn("inline-flex h-[38px] items-center gap-2 rounded-[11px] border bg-raised px-3 text-[13.5px] font-medium transition-[border-color,box-shadow]", on ? "border-brand shadow-[0_0_0_3px_rgb(var(--c-brand)/0.14)]" : "border-ink-1/[0.12]")}>
              <span className={on ? "text-brand" : "text-ink-4"}>{on ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : icon}</span>{item.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

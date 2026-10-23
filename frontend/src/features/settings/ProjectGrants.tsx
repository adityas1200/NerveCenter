import { refreshAfterWrite } from "@/lib/refreshAfterWrite";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Input, Skeleton } from "@/components/ui";
import { FILTER_FIELD, projectsApi, type GrantType, type Grantable, type ProjectGrant } from "@/api/projects";
import { Pager } from "@/components/ops/Pager";
import { usePager } from "@/lib/usePager";
import { Field, SettingsSection } from "./SettingsShell";

/**
 * What a project may use (SPEC-projects-01 FR-31, SPEC-projects-03 FR-21): connections with their routing filters on the
 * Sources tab, knowledge bases and skills on Knowledge and skills. Owners change them; a connection an app admin has not
 * marked shareable says to ask an admin. The server decides every write; this only hides what it would refuse.
 */

const KEY = ["projects", "settings"] as const;
const errorText = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong");

export function GrantsSection({ projectId, globalAdmin, types, title }: { projectId: string; globalAdmin: boolean; types: GrantType[]; title: string }) {
  const key = [...KEY, projectId, "grants"];
  const grants = useQuery({ queryKey: key, queryFn: ({ signal }) => projectsApi.grants(projectId, signal) });
  const grantable = useQuery({ queryKey: [...KEY, projectId, "grantable"], queryFn: ({ signal }) => projectsApi.grantable(projectId, signal) });
  if (grants.isLoading || grantable.isLoading) return <Skeleton className="h-4 w-48" />;
  if (!grants.data || !grantable.data) return null;
  const held = (type: GrantType, id: string) => grants.data.items.find((grant) => grant.resourceType === type && grant.resourceId === id);
  return (
    <SettingsSection title={title}>
      {types.includes("connection") ? <p className="mb-3 text-[13.5px] text-ink-4">Routing filters decide which tickets and jobs from a shared connection land here.</p> : null}
      {types.includes("connection") ? <GrantGroup title="Connections" type="connection" items={grantable.data.connections} held={held} projectId={projectId} queryKey={key} globalAdmin={globalAdmin} /> : null}
      {types.includes("knowledge") ? <GrantGroup title="Knowledge" type="knowledge" items={grantable.data.knowledge} held={held} projectId={projectId} queryKey={key} globalAdmin={globalAdmin} /> : null}
      {types.includes("skill") ? <GrantGroup title="Skills" type="skill" items={grantable.data.skills} held={held} projectId={projectId} queryKey={key} globalAdmin={globalAdmin} /> : null}
    </SettingsSection>
  );
}

type GrantItem = Grantable["connections"][number] | Grantable["knowledge"][number];

function GrantGroup({ title, type, items, held, projectId, queryKey, globalAdmin }: { title: string; type: GrantType; items: GrantItem[]; held: (type: GrantType, id: string) => ProjectGrant | undefined; projectId: string; queryKey: readonly unknown[]; globalAdmin: boolean }) {
  // Knowledge and skills share a tab, so each group pages under its own name.
  const pager = usePager(items.length, { prefix: type });
  return (
    <div className="mb-4">
      <h3 className="mb-1 text-[13px] font-semibold text-ink-3">{title}</h3>
      {!items.length ? <p className="text-[13px] text-ink-5">None in the library.</p> : null}
      <ul className="divide-y divide-line/60">
        {pager.slice(items).map((item) => <GrantRow key={item.id} type={type} item={item} grant={held(type, item.id)} projectId={projectId} queryKey={queryKey} globalAdmin={globalAdmin} />)}
      </ul>
      <Pager {...pager.pagerProps} noun={title.toLowerCase()} className="px-0" />
    </div>
  );
}

function GrantRow({ type, item, grant, projectId, queryKey, globalAdmin }: { type: GrantType; item: GrantItem; grant?: ProjectGrant; projectId: string; queryKey: readonly unknown[]; globalAdmin: boolean }) {
  const queryClient = useQueryClient();
  const provider = "provider" in item ? item.provider : "";
  const filter = FILTER_FIELD[provider];
  const [values, setValues] = useState((grant?.scope?.[filter?.field ?? ""] ?? []).join(", "));
  // SPEC-projects-02 FR-15: an owner grants only connections an app admin marked shareable; revoking is always allowed.
  const locked = type === "connection" && !globalAdmin && !("projectAdminsMayGrant" in item && item.projectAdminsMayGrant);
  const done = () => void refreshAfterWrite(queryClient, { queryKey });
  const save = useMutation({
    mutationFn: () => projectsApi.grant(projectId, { resourceType: type, resourceId: item.id, ...(filter ? { scope: { [filter.field]: values.split(",").map((value) => value.trim()).filter(Boolean) } } : {}) }),
    onSuccess: done,
  });
  const revoke = useMutation({ mutationFn: () => projectsApi.revoke(projectId, type, item.id), onSuccess: done });
  const error = save.error ?? revoke.error;
  return (
    <li className="py-2">
      <div className="flex items-center gap-2">
        <span className="flex-1 truncate text-[14px] text-ink-2">{item.name}{provider ? <span className="text-ink-5"> · {provider}</span> : null}</span>
        {grant ? <Badge variant="secondary">Granted</Badge> : null}
        {grant ? <Button variant="outline" size="sm" onClick={() => revoke.mutate()} disabled={revoke.isPending} busy={revoke.isPending}>Remove</Button> : null}
        {!grant ? <Button variant="outline" size="sm" onClick={() => save.mutate()} disabled={locked || save.isPending} title={locked ? "Ask an admin" : undefined}>Grant</Button> : null}
      </div>
      {locked && !grant ? <p className="text-[12.5px] text-ink-5">Ask an admin</p> : null}
      {filter && (grant || !locked) ? (
        <form className="mt-1.5 flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
          <Field label={filter.label} htmlFor={`scope-${item.id}`} help="Comma separated." className="flex-1"><Input id={`scope-${item.id}`} value={values} onChange={(event) => setValues(event.target.value)} /></Field>
          {grant ? <Button type="submit" variant="outline" size="sm" disabled={save.isPending} busy={save.isPending}>Save filter</Button> : null}
        </form>
      ) : null}
      {/* FR-27: an overlap with another project's filter comes back as a 409 naming the project and value. */}
      {error ? <p role="alert" className="mt-1 text-[13px] text-rose-700">{errorText(error)}</p> : null}
    </li>
  );
}

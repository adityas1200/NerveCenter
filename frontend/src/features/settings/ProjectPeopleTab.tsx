import { refreshAfterWrite } from "@/lib/refreshAfterWrite";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Minus, Trash2 } from "lucide-react";
import { projectsApi, ROLE_LABEL, type ProjectRole } from "@/api/projects";
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Skeleton, confirmAction, useToast } from "@/components/ui";
import { OpsBody, OpsHead, OpsRow, OpsTable, OpsTd, OpsTh } from "@/components/ops/OpsTable";
import { AGENT_NAME } from "@/components/ops/agentPanelContext";
import { Pager } from "@/components/ops/Pager";
import { myProjectsKey } from "@/lib/projectContext";
import { usePager } from "@/lib/usePager";
import { PersonPicker } from "@/features/projects/PersonPicker";
import { SettingsSection } from "./SettingsShell";
import { queryKeys } from "@/api/queryKeys";

/**
 * People in this project (SPEC-projects-03 FR-7, FR-21): everyone in it sees who is in it and what each role may do;
 * owners (and app admins) add people, change roles and remove them. The server keeps at least one owner.
 */

const ROLES: ProjectRole[] = ["viewer", "developer", "owner"];
const errorText = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong");
type Mark = "yes" | "no" | string;
const MATRIX: Array<[string, Mark, Mark, Mark, Mark]> = [
  ["See tickets, pipelines, boards and tasks", "yes", "yes", "yes", "yes"],
  [`Start ${AGENT_NAME}, work tickets, boards and routines`, "no", "yes", "yes", "Asks first"],
  ["Edit knowledge and skills", "no", "yes", "yes", "Proposes"],
  [`Approve what ${AGENT_NAME} wants to do`, "no", "yes", "yes", "no"],
  [`Settings, sources and ${AGENT_NAME}'s limits`, "no", "no", "yes", "no"],
  ["People and roles", "no", "no", "yes", "no"],
];

function MarkCell({ mark }: { mark: Mark }) {
  if (mark === "yes") return <Check className="mx-auto h-4 w-4 text-emerald-600" aria-label="Yes" />;
  if (mark === "no") return <Minus className="mx-auto h-4 w-4 text-ink-5" aria-label="No" />;
  return <span className="text-[12.5px] text-ink-3">{mark}</span>;
}

export function ProjectPeopleTab({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [adding, setAdding] = useState<ProjectRole>("viewer");
  const key = ["projects", "settings", projectId, "members"];
  const members = useQuery({ queryKey: key, queryFn: ({ signal }) => projectsApi.members(projectId, signal) });
  const done = () => { void refreshAfterWrite(queryClient, { queryKey: key }); void refreshAfterWrite(queryClient, { queryKey: myProjectsKey }); void refreshAfterWrite(queryClient, { queryKey: queryKeys.access }); };
  const onError = (error: unknown) => toast.error("Not changed", errorText(error));
  const add = useMutation({ mutationFn: (userId: string) => projectsApi.addMember(projectId, userId, adding), onSuccess: done, onError });
  const setRole = useMutation({ mutationFn: ({ user, role }: { user: string; role: ProjectRole }) => projectsApi.setRole(projectId, user, role), onSuccess: done, onError });
  const remove = useMutation({ mutationFn: (user: string) => projectsApi.removeMember(projectId, user), onSuccess: done, onError });
  const items = members.data?.items ?? [];
  // Settings keeps its other params when the tab changes, so this list's page has its own name.
  const pager = usePager(items.length, { prefix: "people" });
  return (
    <div className="space-y-4">
      <SettingsSection title="People" action={<span className="text-[13px] tabular-nums text-ink-4">{items.length}</span>}>
        {canManage ? (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <PersonPicker className="min-w-[240px] flex-1" inputClassName="h-9 rounded-lg" placeholder="Add a person" exclude={items.map((member) => member.userId)} onPick={(person) => add.mutate(person.id)} />
            <Select value={adding} onValueChange={(value) => setAdding(value as ProjectRole)}>
              <SelectTrigger aria-label="Role for the next person" className="h-9 w-[130px]"><SelectValue /></SelectTrigger>
              <SelectContent>{ROLES.map((role) => <SelectItem key={role} value={role}>{ROLE_LABEL[role]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        ) : null}
        {members.isLoading ? <Skeleton className="h-4 w-48" /> : null}
        {members.isError ? <p role="alert" className="text-[13.5px] text-rose-700">{errorText(members.error)}</p> : null}
        {members.data && !items.length ? <p className="text-[13.5px] text-ink-4">No one yet. App admins can always open it.</p> : null}
        {items.length ? (
          <OpsTable minWidth={520}>
            <OpsHead><OpsTh>Person</OpsTh><OpsTh className="w-[170px]">Role</OpsTh>{canManage ? <OpsTh className="w-[56px]"><span className="sr-only">Remove</span></OpsTh> : null}</OpsHead>
            <OpsBody>
              {pager.slice(items).map((member, index) => (
                <OpsRow key={member.userId} index={index}>
                  <OpsTd><span className="block truncate font-medium text-ink-1">{member.name || member.userId}</span>{member.email ? <span className="block truncate text-[12px] text-ink-4">{member.email}</span> : null}</OpsTd>
                  <OpsTd>
                    {canManage ? (
                      <Select value={member.role} onValueChange={(role) => setRole.mutate({ user: member.userId, role: role as ProjectRole })}>
                        <SelectTrigger aria-label={`Role of ${member.name || member.userId}`} className="h-8 w-[140px]"><SelectValue /></SelectTrigger>
                        <SelectContent>{ROLES.map((role) => <SelectItem key={role} value={role}>{ROLE_LABEL[role]}</SelectItem>)}</SelectContent>
                      </Select>
                    ) : <span className="text-ink-3">{ROLE_LABEL[member.role]}</span>}
                  </OpsTd>
                  {canManage ? (
                    <OpsTd><Button variant="outline" size="sm" aria-label={`Remove ${member.name || member.userId}`} onClick={() => { void confirmAction({ title: `Remove ${member.name || member.userId}?`, description: "They lose access to this project at once.", confirmLabel: "Remove", destructive: true }).then((ok) => { if (ok) remove.mutate(member.userId); }); }}><Trash2 className="h-3.5 w-3.5" /></Button></OpsTd>
                  ) : null}
                </OpsRow>
              ))}
            </OpsBody>
          </OpsTable>
        ) : null}
        <Pager {...pager.pagerProps} noun="people" className="px-0" />
      </SettingsSection>
      <SettingsSection title="Roles">
        <OpsTable minWidth={520}>
          <OpsHead><OpsTh /><OpsTh className="w-[100px] text-center">Viewer</OpsTh><OpsTh className="w-[110px] text-center">Developer</OpsTh><OpsTh className="w-[100px] text-center">Owner</OpsTh><OpsTh className="w-[110px] text-center text-brand">{AGENT_NAME}</OpsTh></OpsHead>
          <OpsBody>
            {MATRIX.map(([label, ...marks], index) => (
              <OpsRow key={label} index={index}>
                <OpsTd>{label}</OpsTd>
                {marks.map((mark, column) => <OpsTd key={column} className={column === 3 ? "bg-brand/[0.04] text-center" : "text-center"}><MarkCell mark={mark} /></OpsTd>)}
              </OpsRow>
            ))}
          </OpsBody>
        </OpsTable>
      </SettingsSection>
    </div>
  );
}

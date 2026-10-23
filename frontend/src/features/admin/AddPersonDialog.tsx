import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { adminApi, type AdminUser } from "@/api/admin";
import type { Role } from "@/auth/rbac";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, useToast } from "@/components/ui";
import { Field } from "@/features/settings/SettingsShell";

// SPEC-projects-03 FR-1, FR-2: what each app role means. Inside a project, the project role decides.
const ROLE_LABEL: Record<Role, string> = { admin: "Admin", developer: "Developer", viewer: "Viewer" };
const ROLE_HELP: Record<Role, string> = {
  admin: "Runs the app: people, connections and every project",
  developer: "Can create projects; what they do inside one comes from their role there",
  viewer: "Sees the projects they are added to and the open ones",
};
const ROLE_IDS: Role[] = ["viewer", "developer", "admin"];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Add a person by email (or their sign-in id) with an app role before they first sign in; then add them to projects. */
export function AddPersonDialog({ users, onClose, onAdded }: { users: AdminUser[]; onClose: () => void; onAdded: () => void }) {
  const toast = useToast();
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [touched, setTouched] = useState(false);
  const trimmed = id.trim();
  const idError = !trimmed ? "Enter an email or user id" : trimmed.includes("@") && !EMAIL.test(trimmed) ? "Enter a valid email" : /\s/.test(trimmed) ? "No spaces in a user id" : trimmed.length > 128 ? "Too long" : users.some((user) => user.id.toLowerCase() === trimmed.toLowerCase() || (user.email || "").toLowerCase() === trimmed.toLowerCase()) ? "Already a user" : null;
  const create = useMutation({
    mutationFn: () => adminApi.upsertUser({ id: trimmed, name: name.trim() || trimmed, email: trimmed.includes("@") ? trimmed : undefined, role: role }),
    onSuccess: () => { toast.success("Person added"); onAdded(); },
  });
  const submit = () => { setTouched(true); if (!idError) create.mutate(); };
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add person</DialogTitle>
          <DialogDescription>The role applies from their first sign-in.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4 px-5 pb-2" onSubmit={(event) => { event.preventDefault(); submit(); }} noValidate>
          <Field label="Email or user id" htmlFor="add-user-id" help="What they sign in with">
            <Input id="add-user-id" value={id} onChange={(event) => setId(event.target.value)} aria-invalid={Boolean(touched && idError)} aria-describedby={touched && idError ? "add-user-id-error" : undefined} placeholder="name@company.com" />
            {touched && idError ? <p id="add-user-id-error" role="alert" className="mt-1 text-[13px] text-rose-700">{idError}</p> : null}
          </Field>
          <Field label="Display name" htmlFor="add-user-name" help="Optional">
            <Input id="add-user-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Priya Nair" />
          </Field>
          <Field label="App role" htmlFor="add-user-role" help={ROLE_HELP[role]}>
            <Select value={role} onValueChange={(value) => setRole(value as Role)}>
              <SelectTrigger id="add-user-role" aria-label="App role"><SelectValue /></SelectTrigger>
              <SelectContent>{ROLE_IDS.map((item) => <SelectItem key={item} value={item}>{ROLE_LABEL[item]}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          {create.error ? <p role="alert" className="break-words rounded-xl border border-rose-200 bg-rose-50 p-3 text-[13px] text-rose-800">{create.error instanceof Error ? create.error.message : "Not added"}</p> : null}
          <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
        </form>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={create.isPending} busy={create.isPending} onClick={submit}>{create.isPending ? "Adding" : "Add person"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

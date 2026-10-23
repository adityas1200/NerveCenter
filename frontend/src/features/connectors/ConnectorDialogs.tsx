import { useMutation } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { connectorsApi, fieldApplies, withFieldDefaults, type Connector, type ConnectorSaveInput, type CustomConnectionInput, type McpTransport } from "@/api/connectors";
import { knowledgeApi } from "@/api/library";
import { AGENT_NAME } from "@/components/ops/agentPanelContext";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch, useToast } from "@/components/ui";
import { Field } from "@/components/ops/Field";
import { cn } from "@/lib/utils";

/** Git-hosting connectors whose repository can also be read for knowledge, in one setup step
 * instead of a second, separate one in Knowledge with the same repo/branch/token typed twice. */
const GIT_KNOWLEDGE_CONNECTORS = new Set(["github"]);

/**
 * Two forms. Configure a catalog connector: the non-secret fields, the secrets, and under
 * Advanced the MCP server the agent launches. Add connection: an MCP server (a URL or a command,
 * like Claude Code's .mcp.json), a REST API, or a command-line tool. Secret values are never shown back.
 */

const TRANSPORT_LABEL: Record<McpTransport, string> = { stdio: "Command (stdio)", http: "Remote URL (HTTP)", sse: "Remote URL (SSE)" };

interface McpDraft { transport: McpTransport; command: string; args: string; url: string }
const BLANK_MCP: McpDraft = { transport: "stdio", command: "", args: "", url: "" };
interface ConnectorDraft { settings: Record<string, string>; secrets: Record<string, string>; advanced: boolean; overrideMcp: boolean; alsoKnowledge: boolean; mcp: McpDraft }
const BLANK_CONNECTOR: ConnectorDraft = { settings: {}, secrets: {}, advanced: false, overrideMcp: false, alsoKnowledge: false, mcp: BLANK_MCP };

export function ConnectorDialog({ connector, onOpenChange, onSaved }: { connector: Connector | null; onOpenChange: (open: boolean) => void; onSaved: (saved: Connector) => Promise<void> | void }) {
  const toast = useToast();
  const [draft, setDraft] = useState(BLANK_CONNECTOR);
  const { settings, secrets, advanced, overrideMcp, alsoKnowledge } = draft;
  const { transport, command, args, url } = draft.mcp;
  const edit = (changes: Partial<ConnectorDraft>) => setDraft((current) => ({ ...current, ...changes }));
  const editMcp = (changes: Partial<McpDraft>) => setDraft((current) => ({ ...current, mcp: { ...current.mcp, ...changes } }));
  const setSetting = (key: string, value: string) => setDraft((current) => ({ ...current, settings: { ...current.settings, [key]: value } }));
  const setSecret = (key: string, value: string) => setDraft((current) => ({ ...current, secrets: { ...current.secrets, [key]: value } }));
  const offersKnowledge = Boolean(connector && GIT_KNOWLEDGE_CONNECTORS.has(connector.id) && !connector.configured);
  useEffect(() => {
    if (!connector) return;
    const mcp = connector.mcp;
    setDraft({ ...BLANK_CONNECTOR, settings: withFieldDefaults(connector.fields ?? [], connector.settings), mcp: { transport: (mcp?.transport as McpTransport) || "stdio", command: mcp?.command || "", args: (mcp?.args || []).join(" "), url: mcp?.url || "" } });
  }, [connector]);

  const save = useMutation({
    mutationFn: async () => {
      // Only the way of connecting that was picked is sent: the other one's client ID or access
      // token would otherwise be saved alongside it and end up in the agent's environment.
      const applicable = new Set((connector!.fields ?? []).filter((field) => fieldApplies(field, settings)).map((field) => field.key));
      const input: ConnectorSaveInput = {
        settings: Object.fromEntries(Object.entries(settings).filter(([key]) => applicable.has(key))),
        secrets: Object.fromEntries(Object.entries(secrets).filter(([key, value]) => value.trim() && (connector!.secrets ?? []).some((secret) => secret.key === key && fieldApplies(secret, settings)))),
      };
      if (overrideMcp) input.mcp = transport === "stdio" ? { transport, command, args } : { transport, url };
      const saved = await connectorsApi.save(connector!.id, input);
      // Whole repository, not scoped to folders: the connector's own "add" happens once, at first
      // connect, so there is no existing knowledge base to update on a later edit - Knowledge's own
      // "Add knowledge base" still covers picking specific folders, or a repository unrelated to code.
      if (offersKnowledge && alsoKnowledge && settings.repository?.trim()) {
        await knowledgeApi.add({ title: saved.name, url: `https://github.com/${settings.repository.trim().replace(/\.git$/i, "")}`, branch: settings.defaultBranch?.trim() || undefined, token: secrets.token?.trim() || undefined }).catch((error) => {
          toast.error("Connected, but not added as knowledge", error instanceof Error ? error.message : "Try again.");
        });
      }
      return saved;
    },
    onSuccess: async (saved) => { onOpenChange(false); toast.info(`${saved.name} saved`, "Testing the connection now."); await onSaved(saved); },
    onError: (error) => toast.error("Connector not saved", error instanceof Error ? error.message : "Try again."),
  });

  if (!connector) return <Dialog open={false} onOpenChange={onOpenChange} />;
  // Only the way of connecting the user picked is shown, so a service principal is never asked
  // for a personal access token (and the Connect button is not blocked waiting for one).
  const fields = (connector.fields ?? []).filter((field) => fieldApplies(field, settings));
  const secretFields = (connector.secrets ?? []).filter((secret) => fieldApplies(secret, settings));
  const missingField = fields.some((field) => field.required && !String(settings[field.key] || "").trim());
  const missingSecret = secretFields.some((secret) => secret.required && !connector.secretsSet.includes(secret.env) && !String(secrets[secret.key] || "").trim());
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>{connector.configured ? `Configure ${connector.name}` : `Connect ${connector.name}`}</DialogTitle><DialogDescription>{connector.description}</DialogDescription></DialogHeader>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 pb-2">
          <div className="grid gap-3 sm:grid-cols-2">
            {fields.map((field) => (
              <Field key={field.key} label={field.label} htmlFor={`connector-${field.key}`} required={field.required} hint={field.env ? `${AGENT_NAME} reads it as ${field.env}` : undefined} wide={/url|host|site|instance/i.test(field.key)}>
                {field.choices ? (
                  <Select value={settings[field.key] || field.default || field.choices[0].value} onValueChange={(value) => setSetting(field.key, value)}>
                    <SelectTrigger id={`connector-${field.key}`} aria-label={field.label}><SelectValue /></SelectTrigger>
                    <SelectContent>{field.choices.map((choice) => <SelectItem key={choice.value} value={choice.value}>{choice.label}</SelectItem>)}</SelectContent>
                  </Select>
                ) : (
                  <Input id={`connector-${field.key}`} value={settings[field.key] || ""} onChange={(event) => setSetting(field.key, event.target.value)} placeholder={field.placeholder} autoComplete="off" />
                )}
              </Field>
            ))}
          </div>
          {secretFields.length ? (
            <div>
              <p className="text-[13.5px] font-semibold text-ink-2">Secrets</p>
              <p className="mt-0.5 text-[12.5px] text-ink-4">Stored in the secret store, never in operations.yaml. Leave a field blank to keep the stored value.</p>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {secretFields.map((secret) => {
                  const stored = connector.secretsSet.includes(secret.env);
                  return (
                    <Field key={secret.key} label={secret.label} htmlFor={`connector-secret-${secret.key}`} required={secret.required && !stored} hint={`${secret.env}${stored ? " · stored" : ""}`}>
                      <Input id={`connector-secret-${secret.key}`} type="password" value={secrets[secret.key] || ""} onChange={(event) => setSecret(secret.key, event.target.value)} placeholder={stored ? "••••••••  (keep)" : ""} autoComplete="new-password" />
                    </Field>
                  );
                })}
              </div>
            </div>
          ) : null}
          {offersKnowledge ? (
            <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
              <div className="min-w-0">
                <label htmlFor="connector-also-knowledge" className="text-[13.5px] font-medium text-ink-2">Use as a knowledge source too</label>
                <p className="mt-0.5 text-[12.5px] text-ink-4">Reads the whole repository as knowledge, using the repository and credentials above. For specific folders only, or an unrelated repository, use Knowledge&apos;s own &quot;Add knowledge base&quot; instead.</p>
              </div>
              <Switch id="connector-also-knowledge" checked={alsoKnowledge} onCheckedChange={(checked) => edit({ alsoKnowledge: checked })} />
            </div>
          ) : null}
          {connector.hasMcpDefault !== false ? <div className="border-t border-line pt-3">
            <button type="button" className="flex items-center gap-1.5 text-[13.5px] font-semibold text-brand" onClick={() => edit({ advanced: !advanced })} aria-expanded={advanced}>{advanced ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}Advanced</button>
            {advanced ? (
              <div className="mt-3 space-y-3 rounded-xl border border-line bg-raised p-3">
                <p className="text-[13px] text-ink-3">{connector.mcp ? "Runs:" : "Uses the default MCP server for this system."} {connector.mcp ? <span className="font-mono text-[12.5px] text-ink-1">{connector.mcp.command ? `${connector.mcp.command} ${connector.mcp.args.join(" ")}` : connector.mcp.url}</span> : null}</p>
                <label className="flex items-center gap-2 text-[13.5px] text-ink-2"><input type="checkbox" className="h-4 w-4 accent-violet-600" checked={overrideMcp} onChange={(event) => edit({ overrideMcp: event.target.checked })} />Use a different MCP server</label>
                {overrideMcp ? <McpFields mcp={draft.mcp} onChange={editMcp} /> : null}
              </div>
            ) : null}
          </div> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" disabled={save.isPending || missingField || missingSecret} onClick={() => save.mutate()}>{save.isPending ? "Saving" : connector.configured ? "Save" : "Connect"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type NewKind = "mcp" | "api" | "cli" | "git";
interface EnvRow { key: string; value: string }
interface ConnectionDraft { kind: NewKind; title: string; description: string; mcp: McpDraft; baseUrl: string; auth: "none" | "bearer"; token: string; repository: string; branch: string; asKnowledge: boolean; env: EnvRow[] }
const BLANK_CONNECTION: ConnectionDraft = { kind: "mcp", title: "", description: "", mcp: BLANK_MCP, baseUrl: "", auth: "none", token: "", repository: "", branch: "", asKnowledge: false, env: [] };
const KIND_CHOICES: Array<{ value: NewKind; label: string; hint: string }> = [
  { value: "mcp", label: "MCP server", hint: `A tool server ${AGENT_NAME} starts or calls.` },
  { value: "api", label: "REST API", hint: `An HTTP API ${AGENT_NAME} calls directly.` },
  { value: "cli", label: "Command-line tool", hint: `A program on this machine ${AGENT_NAME} runs, such as git or gh.` },
  { value: "git", label: "Git / Bitbucket", hint: `A repository ${AGENT_NAME} reads pipeline code from and opens pull requests against, or reads as knowledge.` },
];
/** Bitbucket Cloud access tokens authenticate as "x-token-auth"; other hosts take the knowledge default. */
const gitTokenUsername = (repository: string) => (/^https:\/\/([^/]+\.)?bitbucket\.org\//i.test(repository) ? "x-token-auth" : undefined);

/**
 * Add connection: an MCP server, a REST API, a command-line tool, or a git repository, saved into operations.yaml
 * `connections`. Tokens and variable values go to the secret store and are referenced as ${VAR}.
 */
export function AddConnectionDialog({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => Promise<void> | void }) {
  const toast = useToast();
  const [draft, setDraft] = useState(BLANK_CONNECTION);
  const { kind, title, description, baseUrl, auth, token, repository, branch, asKnowledge, env } = draft;
  const { transport, command, args, url } = draft.mcp;
  const edit = (changes: Partial<ConnectionDraft>) => setDraft((current) => ({ ...current, ...changes }));
  const editMcp = (changes: Partial<McpDraft>) => setDraft((current) => ({ ...current, mcp: { ...current.mcp, ...changes } }));
  const editEnv = (change: (rows: EnvRow[]) => EnvRow[]) => setDraft((current) => ({ ...current, env: change(current.env) }));
  useEffect(() => { if (open) setDraft(BLANK_CONNECTION); }, [open]);
  const save = useMutation({
    mutationFn: async () => {
      const variables = Object.fromEntries(env.filter((row) => row.key.trim()).map((row) => [row.key.trim().toUpperCase(), row.value]));
      const common = { title: title.trim(), description: description.trim() || undefined };
      let input: CustomConnectionInput;
      if (kind === "api") input = { kind: "api", ...common, baseUrl: baseUrl.trim(), auth, token: auth === "bearer" ? token.trim() || undefined : undefined };
      else if (kind === "git") input = { kind: "git", ...common, repository: repository.trim(), branch: branch.trim() || undefined, token: token.trim() || undefined, knowledge: asKnowledge };
      else if (kind === "cli") input = { kind: "cli", ...common, command: command.trim(), args: args.trim() || undefined, env: variables };
      else input = { kind: "mcp", ...common, transport, env: variables, ...(transport === "stdio" ? { command: command.trim(), args: args.trim() } : { url: url.trim() }) };
      const saved = await connectorsApi.saveCustom(input);
      // Knowledge reads its own clone of the repository and branch; the connection above stays for Sonic's git work.
      if (kind === "git" && asKnowledge) {
        await knowledgeApi.add({ title: title.trim(), url: repository.trim().replace(/\/+$/, ""), branch: branch.trim() || undefined, token: token.trim() || undefined, username: gitTokenUsername(repository.trim()) }).catch((error) => {
          toast.error("Connected, but not added as knowledge", error instanceof Error ? error.message : "Try again.");
        });
      }
      return saved;
    },
    onSuccess: async (saved) => { await onSaved(); onOpenChange(false); toast.success(`${saved.name} added`, `${AGENT_NAME} can use it from the next task.`); },
    onError: (error) => toast.error("Connector not added", error instanceof Error ? error.message : "Try again."),
  });
  const valid = title.trim().length > 0 && (
    kind === "api" ? /^https?:\/\/\S+$/i.test(baseUrl.trim()) && (auth === "none" || token.trim().length > 0)
      : kind === "git" ? /^https:\/\/\S+$/i.test(repository.trim())
      : kind === "cli" ? /^\S+$/.test(command.trim())
        : transport === "stdio" ? command.trim().length > 0 : /^https?:\/\//i.test(url.trim()));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>Add connector</DialogTitle><DialogDescription>Secrets are stored securely.</DialogDescription></DialogHeader>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 pb-2">
          <fieldset>
            <legend className="mb-1.5 text-[13px] font-medium text-ink-3">Kind</legend>
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Kind of connection">
              {KIND_CHOICES.map((choice) => (
                <label key={choice.value} className={cn("flex cursor-pointer flex-col gap-0.5 rounded-xl border px-3 py-2.5 transition-colors", kind === choice.value ? "border-brand bg-raised" : "border-line bg-raised hover:border-line-strong")}>
                  <span className="flex items-center gap-2 text-[13.5px] font-semibold text-ink-1"><input type="radio" name="connection-kind" value={choice.value} checked={kind === choice.value} onChange={() => edit({ kind: choice.value })} className="h-3.5 w-3.5 accent-violet-600" />{choice.label}</span>
                  <span className="text-[12.5px] leading-4 text-ink-4">{choice.hint}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={kind === "git" ? "Connection name" : "Name"} htmlFor="connection-title" required><Input id="connection-title" value={title} onChange={(event) => edit({ title: event.target.value })} placeholder={kind === "api" ? "HR directory" : kind === "git" ? "Data platform repo" : kind === "cli" ? "GitHub CLI" : "Runbook search"} autoComplete="off" /></Field>
            <Field label="Used for" htmlFor="connection-description"><Input id="connection-description" value={description} onChange={(event) => edit({ description: event.target.value })} placeholder={kind === "git" ? "Pipeline code, or runbooks" : "Optional"} autoComplete="off" /></Field>
          </div>
          {kind === "mcp" ? <McpFields mcp={draft.mcp} onChange={editMcp} /> : null}
          {kind === "api" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Base URL" htmlFor="api-base-url" required wide><Input id="api-base-url" className="font-mono" value={baseUrl} onChange={(event) => edit({ baseUrl: event.target.value })} placeholder="https://hr.example.com/api" autoComplete="off" /></Field>
              <Field label="Authentication" htmlFor="api-auth">
                <Select value={auth} onValueChange={(value) => edit({ auth: value as "none" | "bearer" })}><SelectTrigger id="api-auth" aria-label="Authentication"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">None</SelectItem><SelectItem value="bearer">Bearer token</SelectItem></SelectContent></Select>
              </Field>
              {auth === "bearer" ? <Field label="Token" htmlFor="api-token" required hint="Stored in the secret store."><Input id="api-token" type="password" value={token} onChange={(event) => edit({ token: event.target.value })} autoComplete="new-password" /></Field> : null}
            </div>
          ) : null}
          {kind === "git" ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Repository link" htmlFor="git-repository" required wide><Input id="git-repository" className="font-mono" value={repository} onChange={(event) => edit({ repository: event.target.value })} placeholder="https://bitbucket.org/acme/data-platform" autoComplete="off" /></Field>
                <Field label="Branch" htmlFor="git-branch" hint="Leave blank for main."><Input id="git-branch" className="font-mono" value={branch} onChange={(event) => edit({ branch: event.target.value })} placeholder="main" autoComplete="off" /></Field>
                <Field label="Personal access token" htmlFor="git-token" hint="Stored in the secret store. Leave blank for a public repository."><Input id="git-token" type="password" value={token} onChange={(event) => edit({ token: event.target.value })} autoComplete="new-password" /></Field>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
                <div className="min-w-0">
                  <label htmlFor="git-as-knowledge" className="text-[13.5px] font-medium text-ink-2">Use as knowledge</label>
                  <p className="mt-0.5 text-[12.5px] text-ink-4">{asKnowledge ? "Reads this branch as knowledge. It does not become the code-fix repository." : `Off: ${AGENT_NAME} uses it for pipeline code and pull requests.`}</p>
                </div>
                <Switch id="git-as-knowledge" checked={asKnowledge} onCheckedChange={(checked) => edit({ asKnowledge: checked })} />
              </div>
            </div>
          ) : null}
          {kind === "cli" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Command" htmlFor="cli-command" required hint="The program name only."><Input id="cli-command" className="font-mono" value={command} onChange={(event) => editMcp({ command: event.target.value })} placeholder="gh" autoComplete="off" /></Field>
              <Field label="Default arguments" htmlFor="cli-args"><Input id="cli-args" className="font-mono" value={args} onChange={(event) => editMcp({ args: event.target.value })} placeholder="--repo acme/ops" autoComplete="off" /></Field>
            </div>
          ) : null}
          {kind === "mcp" || kind === "cli" ? (
            <div>
              <div className="flex items-center justify-between"><p className="text-[13.5px] font-semibold text-ink-2">Environment variables</p><Button size="sm" variant="ghost" className="text-brand" onClick={() => editEnv((rows) => [...rows, { key: "", value: "" }])}>Add variable</Button></div>
              <p className="mt-0.5 text-[12.5px] text-ink-4">Values are stored as secrets and passed as the variable. Write <span className="font-mono">{"${OTHER_VAR}"}</span> to reuse one that already exists.</p>
              {env.length ? <div className="mt-2 space-y-2">{env.map((row, index) => (
                <div key={index} className="grid grid-cols-[1fr_1fr_32px] items-center gap-2">
                  <Input aria-label={`Variable ${index + 1} name`} className="font-mono uppercase" value={row.key} onChange={(event) => editEnv((rows) => rows.map((item, i) => i === index ? { ...item, key: event.target.value } : item))} placeholder="API_TOKEN" />
                  <Input aria-label={`Variable ${index + 1} value`} type="password" value={row.value} onChange={(event) => editEnv((rows) => rows.map((item, i) => i === index ? { ...item, value: event.target.value } : item))} placeholder="value" autoComplete="new-password" />
                  <Button size="icon" variant="ghost" aria-label={`Remove variable ${index + 1}`} onClick={() => editEnv((rows) => rows.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}</div> : null}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" disabled={!valid || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Adding" : "Add connector"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function McpFields({ mcp, onChange }: { mcp: McpDraft; onChange: (changes: Partial<McpDraft>) => void }) {
  const { transport, command, args, url } = mcp;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="How to reach it" htmlFor="mcp-transport" wide>
        <Select value={transport} onValueChange={(value) => onChange({ transport: value as McpTransport })}><SelectTrigger id="mcp-transport" aria-label="Transport"><SelectValue /></SelectTrigger><SelectContent>{(Object.keys(TRANSPORT_LABEL) as McpTransport[]).map((value) => <SelectItem key={value} value={value}>{TRANSPORT_LABEL[value]}</SelectItem>)}</SelectContent></Select>
      </Field>
      {transport === "stdio" ? (
        <>
          <Field label="Command" htmlFor="mcp-command" required><Input id="mcp-command" className="font-mono" value={command} onChange={(event) => onChange({ command: event.target.value })} placeholder="uvx" /></Field>
          <Field label="Arguments" htmlFor="mcp-args"><Input id="mcp-args" className="font-mono" value={args} onChange={(event) => onChange({ args: event.target.value })} placeholder="mcp-atlassian" /></Field>
        </>
      ) : (
        <Field label="URL" htmlFor="mcp-url" required wide><Input id="mcp-url" className="font-mono" value={url} onChange={(event) => onChange({ url: event.target.value })} placeholder="https://mcp.example.com/v1/mcp" /></Field>
      )}
    </div>
  );
}

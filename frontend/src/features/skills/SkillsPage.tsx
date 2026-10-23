import { useQuery } from "@tanstack/react-query";
import { ArrowDownAZ, ArrowUpAZ, Check, Lock, Puzzle, SlidersHorizontal, Trash2, Upload, Wand2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { fileToBase64, skillKeys, skillsApi, type Skill } from "@/api/library";
import { useCan } from "@/auth/rbac";
import { AGENT_NAME, useAgentScreen } from "@/components/ops/agentPanelContext";
import { FileWorkspace } from "@/components/ops/FileWorkspace";
import { OpsPage } from "@/components/ops/OpsPage";
import { PageHeader } from "@/components/ops/PageHeader";
import { Pager } from "@/components/ops/Pager";
import { CompactEmptyState, QueryState } from "@/components/ops/StatePanels";
import { Button, Card, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, Tooltip, TooltipContent, TooltipTrigger, SearchInput, confirmAction } from "@/components/ui";
import { defaultFile } from "@/lib/fileTree";
import { cn } from "@/lib/utils";
import { SkillIcon } from "./skillIcons";
import { skillDisplayName, splitDescription } from "./skillText";
import { useAction } from "@/lib/useAction";
import { GRID_PAGE_SIZES, usePager } from "@/lib/usePager";

type OriginFilter = "all" | Skill["origin"];
const ORIGIN_FILTER_LABEL: Record<OriginFilter, string> = { all: "All", plugin: "Built in", custom: "Custom" };

/**
 * Skills: what the agent knows how to do. The list is a grid of cards, one per skill; opening a
 * card gives the skill its own page with the file tree and SKILL.md. Built-in skills ship with the
 * operations plugin and are read-only; custom skills are zip uploads into the workspace's .claude/skills.
 */

const ORIGIN_LABEL: Record<Skill["origin"], string> = { plugin: "Built in", custom: "Custom" };

export function SkillsPage() {
  const { skillId } = useParams();
  const navigate = useNavigate();
  // SPEC-projects-03 FR-6: a project's developers and owners add and remove its skills.
  const admin = useCan("skills.manage");
  const fileInput = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [originFilter, setOriginFilter] = useState<OriginFilter>("all");
  const [sortAsc, setSortAsc] = useState(true);
  const query = useQuery({ queryKey: skillKeys.all, queryFn: ({ signal }) => skillsApi.list(signal) });
  const items = useMemo(() => query.data?.items ?? [], [query.data?.items]);
  const selected = skillId ? items.find((skill) => skill.id === skillId) || null : null;

  const upload = useAction({
    mutationFn: async (file: File) => skillsApi.upload(await fileToBase64(file)),
    invalidate: [skillKeys.all],
    success: (result) => [result.replaced ? `${skillDisplayName(result.name)} replaced` : `${skillDisplayName(result.name)} added`, `${result.files} ${result.files === 1 ? "file" : "files"}. ${AGENT_NAME} can use it from the next task.`],
    onSuccess: (result) => navigate(`/skills/${encodeURIComponent(result.id)}`),
    error: "Skill not uploaded",
  });
  const remove = useAction({
    mutationFn: (id: string) => skillsApi.remove(id),
    invalidate: [skillKeys.all],
    success: "Skill removed",
    onSuccess: () => navigate("/skills", { replace: true }),
    error: "Skill not removed",
  });

  const builtIn = items.filter((skill) => skill.origin === "plugin");
  const custom = items.filter((skill) => skill.origin === "custom");
  const term = search.trim().toLowerCase();
  const matches = (skill: Skill) => !term || `${skill.name} ${skillDisplayName(skill.name)} ${skill.heading || ""} ${skill.description}`.toLowerCase().includes(term);
  const byName = (a: Skill, b: Skill) => skillDisplayName(a.name).localeCompare(skillDisplayName(b.name)) * (sortAsc ? 1 : -1);
  const showBuiltIn = originFilter !== "custom";
  const showCustom = originFilter !== "plugin";
  const visibleBuiltIn = showBuiltIn ? builtIn.filter(matches).sort(byName) : [];
  const visibleCustom = showCustom ? custom.filter(matches).sort(byName) : [];
  const filtered = originFilter !== "all" || Boolean(term);
  const resetKey = JSON.stringify({ term, originFilter, sortAsc });
  const shownIds = skillId ? [] : [...visibleBuiltIn, ...visibleCustom].map((skill) => skill.id);

  useAgentScreen(skillId
    ? { visible: [], open: { kind: "skill", id: skillId, title: selected ? skillDisplayName(selected.name) : undefined }, summary: selected ? `${ORIGIN_LABEL[selected.origin]} skill ${skillDisplayName(selected.name)}` : "Skill page" }
    : { visible: shownIds, open: null, summary: `${builtIn.length} built-in and ${custom.length} custom skills${filtered ? `; showing ${shownIds.length} filtered by ${ORIGIN_FILTER_LABEL[originFilter].toLowerCase()}${term ? ` and "${search.trim()}"` : ""}` : ""}` });

  const uploadControl = admin ? <><input ref={fileInput} type="file" accept=".zip,application/zip" className="hidden" aria-label="Skill zip file" onChange={(event) => { const file = event.target.files?.[0]; if (file) upload.mutate(file); event.target.value = ""; }} /><Button variant="primary" size="sm" disabled={upload.isPending} busy={upload.isPending} onClick={() => fileInput.current?.click()}><Upload className="h-4 w-4" />{upload.isPending ? "Uploading" : "Upload skill (zip)"}</Button></> : undefined;

  if (skillId) {
    return (
      <>
        <PageHeader
          title={selected ? skillDisplayName(selected.name) : skillDisplayName(decodeURIComponent(skillId))}
          back={{ to: "/skills", label: "Skills" }}
          status={selected ? <OriginPill origin={selected.origin} /> : null}
          primary={uploadControl}
          menu={admin && selected?.origin === "custom" ? [{ label: "Remove skill", icon: Trash2, destructive: true, disabled: remove.isPending, onSelect: () => { void confirmAction({ title: `Remove ${skillDisplayName(selected.name)}?`, description: `${AGENT_NAME} can no longer use this skill.`, confirmLabel: "Remove skill", destructive: true }).then((ok) => { if (ok) remove.mutate(selected.id); }); } }] : undefined}
        />
        <QueryState query={query}>
          {selected ? <SkillFiles skill={selected} /> : <Card><CompactEmptyState className="justify-center px-4 py-10">Skill not found</CompactEmptyState></Card>}
        </QueryState>
      </>
    );
  }

  return (
    <OpsPage title="Skills">
      <QueryState query={query}>
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput className="min-w-[220px] flex-1" label="Search skills" value={search} onValueChange={setSearch} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className={cn("h-9 w-9 border border-line", originFilter !== "all" && "border-ink-1 text-ink-1")} aria-label="Filter skills" title="Filter">
                  <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>Created by</DropdownMenuLabel>
                {(["all", "plugin", "custom"] as const).map((value) => (
                  <DropdownMenuItem key={value} onSelect={() => setOriginFilter(value)} className="justify-between">
                    {ORIGIN_FILTER_LABEL[value]}
                    {originFilter === value ? <Check className="h-3.5 w-3.5 text-brand" aria-hidden="true" /> : null}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => { setOriginFilter("all"); setSortAsc(true); }}>Reset filters and sort</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" className="h-9 w-9 border border-line" aria-label={sortAsc ? "Sorted A to Z; click to sort Z to A" : "Sorted Z to A; click to sort A to Z"} onClick={() => setSortAsc((value) => !value)}>
                  {sortAsc ? <ArrowUpAZ className="h-4 w-4" aria-hidden="true" /> : <ArrowDownAZ className="h-4 w-4" aria-hidden="true" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{sortAsc ? "Sort Z to A" : "Sort A to Z"}</TooltipContent>
            </Tooltip>
            {uploadControl ? <div className="ml-auto">{uploadControl}</div> : null}
          </div>
          <SkillGrid label="Built in" icon={Puzzle} items={visibleBuiltIn} resetKey={resetKey} onOpen={(skill) => navigate(`/skills/${encodeURIComponent(skill.id)}`)} empty={showBuiltIn && builtIn.length ? "No skills match" : undefined} />
          <SkillGrid label="Custom" icon={Wand2} items={visibleCustom} prefix="custom" resetKey={resetKey} onOpen={(skill) => navigate(`/skills/${encodeURIComponent(skill.id)}`)} empty={showCustom ? (custom.length ? "No skills match" : "No custom skills") : undefined} />
        </div>
      </QueryState>
    </OpsPage>
  );
}

/** "Morning reviews, weekly reports, recurring checks, and other tasks…" becomes bullets when it lists three or more things. */
function asList(text: string): string[] | null {
  const items = text.replace(/\.$/, "").split(/,\s*(?:and\s+)?/).map((item) => item.trim()).filter(Boolean);
  return items.length >= 3 ? items.map((item) => item.charAt(0).toUpperCase() + item.slice(1)) : null;
}

function OriginPill({ origin }: { origin: Skill["origin"] }) {
  return <span className={cn("shrink-0 rounded-md border px-1.5 py-0.5 text-[11.5px] font-semibold", origin === "plugin" ? "border-line bg-surface-subtle text-ink-3" : "border-line bg-raised text-ink-3")}>{ORIGIN_LABEL[origin]}</span>;
}

/** `prefix` keeps the custom grid's page apart from the built-in grid's page in the URL. */
function SkillGrid({ label, icon: Icon, items, onOpen, empty, prefix, resetKey }: { label: string; icon: typeof Puzzle; items: Skill[]; onOpen: (skill: Skill) => void; empty?: string; prefix?: string; resetKey: string }) {
  const pager = usePager(items.length, { sizes: GRID_PAGE_SIZES, prefix, resetKey });
  if (!items.length && !empty) return null;
  return (
    <section aria-label={`${label} skills`}>
      <h2 className="mb-3 flex items-center gap-2 px-0.5 text-[12px] font-medium text-ink-5">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {label}
        <span className="rounded-full bg-surface-subtle px-1.5 py-px text-[11px] tabular-nums text-ink-4">{items.length}</span>
        <span aria-hidden="true" className="ml-1 h-px flex-1 bg-line" />
      </h2>
      {items.length ? (
        <div className="space-y-4">
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {pager.slice(items).map((skill, index) => {
            const { what } = splitDescription(skill.description);
            const summary = what || skill.description;
            return (
              <li key={skill.id} className={index < 12 ? "stagger-in" : undefined} style={index < 12 ? { animationDelay: `${index * 30}ms` } : undefined}>
                <button type="button" onClick={() => onOpen(skill)} className="group motion-surface flex h-full w-full flex-col rounded-2xl border border-line bg-raised p-4 text-left shadow-card hover:-translate-y-px hover:border-line-strong hover:shadow-card-hover focus-visible:border-brand/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/25">
                  <span className="flex min-w-0 items-center gap-3">
                    <SkillIcon name={skill.name} size="md" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2"><span className="truncate text-[15px] font-semibold text-ink-1">{skillDisplayName(skill.name)}</span>{skill.origin !== "plugin" ? <span className="shrink-0 rounded-md border border-line px-1.5 py-px text-[11px] font-medium text-ink-4">Uploaded</span> : null}</span>
                      {skill.heading ? <span className="mt-0.5 block truncate text-[13px] text-ink-4">{skill.heading}</span> : null}
                    </span>
                  </span>
                  {summary ? <span className="mt-3 line-clamp-2 text-[13.5px] leading-[20px] text-ink-3" title={skill.description}>{summary}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
        {items.length > GRID_PAGE_SIZES[0] ? <Card className="overflow-hidden"><Pager {...pager.pagerProps} noun="skills" /></Card> : null}
        </div>
      ) : <Card><CompactEmptyState className="px-4 py-6">{empty}</CompactEmptyState></Card>}
    </section>
  );
}

function SkillFiles({ skill }: { skill: Skill }) {
  const [params, setParams] = useSearchParams();
  const tree = useQuery({ queryKey: skillKeys.tree(skill.id), queryFn: ({ signal }) => skillsApi.tree(skill.id, signal) });
  const path = params.get("file") ?? (tree.data ? defaultFile(tree.data.items, ["SKILL.md"]) : null);
  const file = useQuery({ queryKey: skillKeys.file(skill.id, path || ""), queryFn: ({ signal }) => skillsApi.file(skill.id, path || "", signal), enabled: Boolean(path) });
  const { what, when } = splitDescription(skill.description);
  return (
    <FileWorkspace
      tree={tree.data?.items ?? []}
      selected={path}
      onSelect={(next) => setParams((current) => { const updated = new URLSearchParams(current); updated.set("file", next); return updated; })}
      fileHref={(next) => `?file=${encodeURIComponent(next)}`}
      file={file.data}
      loading={tree.isPending}
      error={tree.error || file.error}
      emptyText="No files"
      aside={
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <SkillIcon name={skill.name} size="lg" />
            <div className="min-w-0">
              {skill.heading ? <p className="text-[15px] font-semibold leading-6 text-ink-1">{skill.heading}</p> : null}
              <p className="text-[12.5px] text-ink-4">{skillDisplayName(skill.name)} skill</p>
            </div>
          </div>
          <section className="rounded-xl border border-line bg-surface-tint/60 px-3.5 py-3">
            <p className="text-[12px] font-medium text-ink-5">What it does</p>
            <p className="mt-1.5 text-[14px] leading-6 text-ink-2">{what || skill.description}</p>
          </section>
          {when ? (
            <section className="rounded-xl border border-line bg-surface-tint/60 px-3.5 py-3">
              <p className="text-[12px] font-medium text-ink-5">When {AGENT_NAME} uses it</p>
              {asList(when)
                ? <ul className="mt-2 space-y-1.5">{asList(when)!.map((item) => <li key={item} className="flex items-start gap-2 text-[14px] leading-6 text-ink-2"><span aria-hidden="true" className="mt-1 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-raised text-ink-4 ring-1 ring-line"><Check className="h-2.5 w-2.5" /></span>{item}</li>)}</ul>
                : <p className="mt-1.5 text-[14px] leading-6 text-ink-2">{when}</p>}
            </section>
          ) : null}
          <p className="flex items-center gap-1.5 text-[12.5px] text-ink-5">
            {skill.origin === "plugin" ? <Lock className="h-3.5 w-3.5" aria-hidden="true" /> : <Upload className="h-3.5 w-3.5" aria-hidden="true" />}
            {skill.origin === "plugin" ? "Built in, read-only" : "Custom, uploaded to this workspace"}
          </p>
        </div>
      }
    />
  );
}

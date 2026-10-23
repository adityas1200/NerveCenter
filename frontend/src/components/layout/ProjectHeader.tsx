import { ChevronLeft, Inbox } from "lucide-react";
import { ROLE_LABEL, UNROUTED, type MyProject } from "@/api/projects";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui";
import { OutsideLink } from "@/lib/appRouter";
import { useProject } from "@/lib/projectContext";
import { ProjectArt } from "@/features/home/ProjectCard";

function Tile({ project, size }: { project: Pick<MyProject, "id" | "color"> | null; size: number }) {
  if (!project) return null;
  return <span className="inline-block shrink-0 overflow-hidden rounded-lg shadow-[inset_0_0_0_1px_rgb(var(--c-ink-1)/0.06)]" style={{ width: size, height: size }}><ProjectArt project={project} width={18} height={18} className="h-full" /></span>;
}

/**
 * SPEC-projects-03 FR-14: which project you are in, and the way back to Home, where you pick another. No menu. The role
 * shows only when it holds you back; owners and developers need no reminder.
 */
export function ProjectHeader({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { projectId, project } = useProject();
  if (!projectId) return null;
  const unrouted = projectId === UNROUTED;
  const label = unrouted ? "Unrouted" : project?.name ?? projectId;
  const limit = unrouted ? "Read only" : project?.role === "viewer" || project?.role === "open" ? ROLE_LABEL[project.role] : null;
  const tile = unrouted ? <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-line text-ink-4"><Inbox className="h-3.5 w-3.5" aria-hidden="true" /></span> : <Tile project={project} size={28} />;

  if (collapsed) {
    return (
      <Tooltip>
        {/* OutsideLink takes no ref, so the tooltip anchors on a wrapper; focus bubbles up to it. */}
        <TooltipTrigger asChild>
          <span className="block">
            <OutsideLink to="/" onClick={onNavigate} aria-label={`${label}. Back to projects`} className="mx-auto flex h-9 w-9 items-center justify-center rounded-lg hover:bg-ink-1/[0.045]">{tile}</OutsideLink>
          </span>
        </TooltipTrigger>
        <TooltipContent side="right">{label} · Back to projects</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <div className="px-1">
      <OutsideLink to="/" onClick={onNavigate} className="-ml-1 inline-flex h-6 items-center gap-0.5 rounded-md pl-0.5 pr-1.5 text-[12.5px] font-medium text-ink-4 transition-colors hover:bg-ink-1/[0.045] hover:text-ink-1">
        <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />Projects
      </OutsideLink>
      <div className="mt-1.5 flex items-center gap-2.5 px-1">
        {tile}
        <span className="min-w-0 flex-1">
          <b className="block truncate text-[14px] font-semibold tracking-[-0.01em] text-ink-1">{label}</b>
          {limit ? <small className="block truncate font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-4">{limit}</small> : null}
        </span>
      </div>
    </div>
  );
}

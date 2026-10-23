import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { ROLE_LABEL, type MyProject, type ProjectColor } from "@/api/projects";
import { cn } from "@/lib/utils";
import { paintLandscape, reducedMotion } from "./art/dither";

/** A project's dithered landscape, drawn small and shown large. Hovering `hoverTarget` lets the ridges drift. */
export function ProjectArt({ project, width = 168, height = 66, className }: { project: { id: string; color?: ProjectColor | null }; width?: number; height?: number; className?: string }) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const element = canvas.current; if (!element) return undefined;
    paintLandscape(element, project);
    const card = element.closest<HTMLElement>("[data-project-card]");
    if (!card || reducedMotion()) return undefined;
    let frame = 0; let t = 0;
    const step = () => { t += 0.6; paintLandscape(element, project, t); frame = requestAnimationFrame(step); };
    const enter = () => { frame = requestAnimationFrame(step); };
    const leave = () => cancelAnimationFrame(frame);
    card.addEventListener("mouseenter", enter); card.addEventListener("mouseleave", leave);
    // Repaint when the theme flips, so the ramp follows light and dark.
    const observer = new MutationObserver(() => paintLandscape(element, project, t));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => { cancelAnimationFrame(frame); card.removeEventListener("mouseenter", enter); card.removeEventListener("mouseleave", leave); observer.disconnect(); };
  }, [project]);
  return <canvas ref={canvas} width={width} height={height} aria-hidden="true" className={cn("block w-full [image-rendering:pixelated]", className)} />;
}

/** SPEC-projects-03 FR-16: a project on Home is its landscape, its name and your role there. Nothing else. */
export function ProjectCard({ project }: { project: MyProject }) {
  return (
    <Link to={`/p/${project.id}`} data-project-card="" className="group block overflow-hidden rounded-[16px] border border-line bg-raised shadow-card transition-[transform,box-shadow] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-[2px] hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50">
      <ProjectArt project={project} className="h-[158px]" />
      <span className="flex items-baseline justify-between gap-3 px-[18px] pb-[18px] pt-4">
        <b className="truncate text-[16px] font-semibold tracking-[-0.01em] text-ink-1">{project.name}</b>
        <span className="shrink-0 font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-ink-4">{ROLE_LABEL[project.role]}{project.archived ? " · Archived" : ""}</span>
      </span>
    </Link>
  );
}

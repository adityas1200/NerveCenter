import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { BrandMark } from "@/components/layout/BrandMark";
import { OutsidePage } from "@/components/layout/OutsideChrome";
import { Pager } from "@/components/ops/Pager";
import { Skeleton } from "@/components/ui";
import { useMe } from "@/auth/rbac";
import { useMyProjects } from "@/lib/projectContext";
import { GRID_PAGE_SIZES, usePager } from "@/lib/usePager";
import { getCurrentUser } from "@/lib/user";
import { COLOR_INK, colorOf } from "./art/dither";
import { startFooterScene } from "./art/footerScene";
import { startHeroRing } from "./art/heroRing";
import { ProjectCard } from "./ProjectCard";

const greeting = (hour: number) => (hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening");
const mono = "font-mono text-[11px] font-medium uppercase tracking-[0.06em]";

/**
 * Home (SPEC-projects-03 FR-16): the hero, your projects and the footer, nothing else. Your projects come first with your
 * role; then open projects you are not in (for an app admin, every other project). Developers and admins get New project.
 * The greeting and the footer wordmark are the only serif (FR-24).
 */
export function HomePage() {
  const me = useMe().data;
  const projects = useMyProjects();
  const appRole = me?.appRole ?? me?.role;
  const canCreate = appRole === "admin" || appRole === "developer";
  const items = projects.data?.items ?? [];
  const mine = items.filter((item) => item.role !== "admin" && item.role !== "open");
  const others = items.filter((item) => item.role === "admin" || item.role === "open");
  // Two grids on one page, so the second keeps its page under its own name.
  const minePager = usePager(mine.length, { sizes: GRID_PAGE_SIZES });
  const othersPager = usePager(others.length, { sizes: GRID_PAGE_SIZES, prefix: "others" });
  const first = getCurrentUser().name.split(" ")[0] || "there";
  const hero = useRef<HTMLElement | null>(null);
  const ring = useRef<HTMLCanvasElement | null>(null);
  const sphereColors = items.map((item) => COLOR_INK[colorOf(item.id, item.color)]).join(",");
  useEffect(() => {
    if (!ring.current || !hero.current || !projects.data) return undefined;
    return startHeroRing(ring.current, sphereColors ? sphereColors.split(",") : [], hero.current);
  }, [sphereColors, projects.data]);

  return (
    <OutsidePage>
      <section ref={hero} className="mx-auto grid w-[min(1240px,calc(100vw-48px))] items-center gap-6 lg:min-h-[560px] lg:grid-cols-[1fr_520px]">
        <div className="grid justify-items-start gap-6 pb-10 pt-16 lg:pt-0">
          <h1 className="m-0 font-serif text-[clamp(56px,7.4vw,104px)] font-normal leading-[0.92] tracking-[-0.015em] text-ink-1">{greeting(new Date().getHours())},<br />{first}.</h1>
          <p className="m-0 max-w-[520px] text-[17px] leading-[1.55] text-ink-3">The operations harness for data teams. Tickets, pipelines and data quality in one place, with Sonic to investigate and fix what breaks.</p>
        </div>
        <div className="hidden justify-center lg:flex">
          <canvas ref={ring} width={150} height={150} aria-hidden="true" className="h-[520px] w-[520px] [image-rendering:pixelated]" />
        </div>
      </section>

      <section className="mx-auto mt-6 w-[min(1240px,calc(100vw-48px))] pb-24" aria-labelledby="projects-heading">
        <div className="mb-[18px] flex items-baseline gap-3">
          <h2 id="projects-heading" className="m-0 font-display text-[30px] font-semibold leading-[36px] tracking-[-0.025em] text-ink-1">Projects</h2>
          <span className="flex-1" />
          {canCreate ? <Link to="/new" className="inline-flex h-9 items-center gap-1.5 self-center rounded-[10px] bg-ink-1 px-3.5 text-[13.5px] font-semibold text-surface-base transition-colors hover:bg-ink-2"><Plus className="h-4 w-4" aria-hidden="true" />New project</Link> : null}
        </div>
        {projects.isLoading ? <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((key) => <Skeleton key={key} className="h-[214px] rounded-[16px]" />)}</div> : null}
        {projects.isError ? <p role="alert" className="text-[14px] text-rose-700">Projects could not be loaded.</p> : null}
        {projects.data ? (
          mine.length || canCreate ? (
            <>
            <div className="stagger-children grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {minePager.slice(mine).map((project) => <ProjectCard key={project.id} project={project} />)}
              {canCreate ? (
                <Link to="/new" aria-label="New project" className="group grid min-h-[214px] place-items-center rounded-[16px] border border-dashed border-line-strong transition-colors hover:border-ink-5 hover:bg-raised/60">
                  <span className="grid h-12 w-12 place-items-center rounded-full border border-ink-1/10 bg-raised text-ink-3 shadow-card transition-transform group-hover:scale-105"><Plus className="h-5 w-5" aria-hidden="true" /></span>
                </Link>
              ) : null}
            </div>
            <Pager {...minePager.pagerProps} noun="projects" className="mt-5 px-0" />
            </>
          ) : (
            <div className="border-t border-ink-1/[0.08] pt-8">
              <span className={`${mono} text-ink-2`}>No projects yet</span>
              <p className="m-0 mt-2 text-[20px] font-semibold tracking-[-0.01em] text-ink-2">A project owner or an admin can add you.</p>
            </div>
          )
        ) : null}
        {others.length ? (
          <>
            <h3 className={`${mono} mb-4 mt-11 text-ink-4`}>{appRole === "admin" ? "Everything else" : "Open to everyone"}</h3>
            <div className="stagger-children grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{othersPager.slice(others).map((project) => <ProjectCard key={project.id} project={project} />)}</div>
            <Pager {...othersPager.pagerProps} noun="projects" className="mt-5 px-0" />
          </>
        ) : null}
      </section>

      <HomeFooter />
    </OutsidePage>
  );
}

function HomeFooter() {
  const area = useRef<HTMLDivElement | null>(null);
  const word = useRef<HTMLCanvasElement | null>(null);
  const scene = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!area.current || !word.current || !scene.current) return undefined;
    let stop: (() => void) | null = null; let cancelled = false;
    void startFooterScene(area.current, word.current, scene.current).then((done) => { if (cancelled) done(); else stop = done; });
    return () => { cancelled = true; stop?.(); };
  }, []);
  return (
    <footer className="border-t border-ink-1/[0.08] pt-10">
      <div ref={area} className="relative mx-auto w-[min(1240px,calc(100vw-48px))] overflow-hidden" style={{ height: 576 }}>
        <canvas ref={word} aria-label="NerveCenter" className="absolute left-0" />
        <canvas ref={scene} aria-hidden="true" className="absolute left-0 top-0" />
      </div>
      <div className={`mx-auto flex w-[min(1240px,calc(100vw-48px))] justify-between pb-8 pt-5 ${mono} text-ink-4`}><span>© 2026 ZS Associates</span><span className="flex items-center gap-2 font-sans normal-case tracking-normal text-[14px] font-semibold text-ink-1"><BrandMark size={20} />NerveCenter</span></div>
    </footer>
  );
}

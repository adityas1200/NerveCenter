import { useQuery } from "@tanstack/react-query";
import { Eye, Maximize2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { tasksApi, taskKeys } from "@/api/tasks";
import { ErrorNotice } from "@/components/ops/ErrorNotice";
import { Markdown } from "@/components/ops/Markdown";
import { Skeleton } from "@/components/ui";
import { cn } from "@/lib/utils";
import { AgentCard } from "./AgentCard";
import { ARTIFACT_KIND_LABEL, type Artifact } from "./cards";

/**
 * The file the agent asked the reader to look at, framed where it was shown: an HTML report or dashboard
 * in a sandboxed iframe (the server also sends `Content-Security-Policy: sandbox`, so nothing in it runs),
 * an SVG or image fitted to the frame, a markdown document rendered in place. The Result tab gets the
 * tall frame, the thread and the side panel the short one; "Taller" grows either to 900px.
 */

const HEIGHT = { compact: 320, full: 560, taller: 900 } as const;
const ACTION = "inline-flex items-center gap-1 text-[12.5px] font-medium text-ink-4 transition-colors hover:text-ink-1";

export function ArtifactFrame({ artifact, taskId, compact = false, onExpand, onOpenTask, className }: {
  artifact: Artifact; taskId: string; compact?: boolean;
  /** Opens the file beside the task (the file viewer). When absent the frame links to the task instead. */
  onExpand?: (path: string) => void;
  /** Called when the reader follows "Open task" (the side panel closes itself). */
  onOpenTask?: () => void;
  className?: string;
}) {
  const [taller, setTaller] = useState(false);
  const rawUrl = tasksApi.fileUrl(taskId, artifact.path);
  const framed = artifact.media === "html" || artifact.media === "pdf";
  const height = taller ? HEIGHT.taller : compact ? HEIGHT.compact : HEIGHT.full;
  const note = [ARTIFACT_KIND_LABEL[artifact.kind], artifact.summary].filter(Boolean).join(" · ");
  const actions = (
    <>
      {framed ? <button type="button" className={ACTION} onClick={() => setTaller((value) => !value)} aria-pressed={taller}>{taller ? "Fit" : "Taller"}</button> : null}
      {onExpand ? <button type="button" className={ACTION} onClick={() => onExpand(artifact.path)}><Maximize2 className="h-3 w-3" aria-hidden="true" />Expand</button> : <Link to={`/tasks/${encodeURIComponent(taskId)}`} onClick={onOpenTask} className={ACTION}>Open task</Link>}
      <a href={rawUrl} target="_blank" rel="noreferrer" className={ACTION}><Eye className="h-3 w-3" aria-hidden="true" />Open in new tab</a>
    </>
  );
  return (
    <AgentCard title={artifact.title} note={note} action={actions} compact={compact} className={className} bodyClassName="px-0 pb-0 pt-2">
      <div className="border-t border-line">
        {artifact.media === "html" ? <FramedPage src={rawUrl} title={artifact.title} height={height} sandbox />
          : artifact.media === "pdf" ? <FramedPage src={rawUrl} title={artifact.title} height={height} />
          : artifact.media === "image" ? <Picture src={rawUrl} alt={artifact.title} path={artifact.path} height={compact ? HEIGHT.compact : HEIGHT.full} />
          : artifact.media === "markdown" ? <MarkdownArtifact taskId={taskId} path={artifact.path} compact={compact} onOpenFile={onExpand} />
          : <p className="px-4 py-3 text-[13.5px] text-ink-4">This file opens in its own tab. <a href={rawUrl} target="_blank" rel="noreferrer" className="font-medium text-ink-2 underline decoration-line-strong underline-offset-2">{artifact.name}</a></p>}
      </div>
    </AgentCard>
  );
}

/** A page from the task folder in an iframe; a shimmer sits over it until the document has loaded. */
function FramedPage({ src, title, height, sandbox = false }: { src: string; title: string; height: number; sandbox?: boolean }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="relative overflow-hidden rounded-b-xl bg-raised transition-[height] duration-300 ease-out" style={{ height }}>
      {!loaded ? <div className="absolute inset-0 space-y-3 p-5" aria-hidden="true"><Skeleton className="h-5 w-1/3" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-5/6" /><Skeleton className="h-32 w-full" /></div> : null}
      <iframe title={title} src={src} {...(sandbox ? { sandbox: "" } : {})} onLoad={() => setLoaded(true)} className={cn("h-full w-full border-0 bg-raised transition-opacity duration-300", loaded ? "opacity-100" : "opacity-0")} />
    </div>
  );
}

function Picture({ src, alt, path, height }: { src: string; alt: string; path: string; height: number }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  if (state === "error") return <ArtifactError path={path} />;
  return (
    <div className="relative flex items-center justify-center overflow-hidden rounded-b-xl bg-raised p-3" style={{ minHeight: state === "ready" ? undefined : height / 2, maxHeight: height }}>
      {state === "loading" ? <Skeleton className="absolute inset-3" aria-hidden="true" /> : null}
      <img src={src} alt={alt} onLoad={() => setState("ready")} onError={() => setState("error")} className={cn("max-h-full max-w-full object-contain transition-opacity duration-300", state === "ready" ? "opacity-100" : "opacity-0")} style={{ maxHeight: height - 24 }} />
    </div>
  );
}

function MarkdownArtifact({ taskId, path, compact, onOpenFile }: { taskId: string; path: string; compact: boolean; onOpenFile?: (path: string) => void }) {
  const query = useQuery({ queryKey: [...taskKeys.detail(taskId), "file", path], queryFn: ({ signal }) => tasksApi.fileContent(taskId, path, signal), retry: false });
  if (query.error) return <ArtifactError path={path} detail={query.error instanceof Error ? query.error.message : undefined} />;
  if (query.isPending) return <div className="space-y-3 p-4" aria-hidden="true"><Skeleton className="h-4 w-48" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-5/6" /><Skeleton className="h-3 w-2/3" /></div>;
  return <div className={cn("scroll-visible overflow-y-auto px-4 py-3", compact ? "max-h-[320px]" : "max-h-[560px]")}><Markdown className="text-[14px]" taskFilePath={path} onOpenFile={onOpenFile} resolveAsset={(src) => tasksApi.fileUrl(taskId, src)}>{query.data?.content || ""}</Markdown></div>;
}

function ArtifactError({ path, detail }: { path: string; detail?: string }) {
  return <ErrorNotice compact className="m-3" what="The artifact could not be loaded" why={<span className="font-mono text-[12.5px]">{path}</span>} detail={detail} />;
}

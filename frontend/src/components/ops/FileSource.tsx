import { lazy, Suspense } from "react";
import { CodeBlock, Skeleton } from "@/components/ui";

const MermaidBlock = lazy(() => import("@/components/ops/MermaidBlock").then((module) => ({ default: module.MermaidBlock })));

/** A file shown as it is written: a diagram drawn, anything else as numbered code. The file readers share it. */
export function FileSource({ path, content, diagram, className, maxHeight }: { path: string; content: string; diagram: boolean; className: string; maxHeight: string }) {
  return (
    <div className={className}>
      {diagram
        ? <Suspense fallback={<Skeleton className="h-40 w-full" />}><MermaidBlock code={content} className="my-0" /></Suspense>
        : <CodeBlock code={content} language={path.split(".").pop()} maxHeight={maxHeight} showLineNumbers />}
    </div>
  );
}

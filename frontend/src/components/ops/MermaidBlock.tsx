import { useEffect, useState } from "react";
import { CodeBlock, Skeleton } from "@/components/ui";
import { sweepOrphanedMermaidElements } from "@/lib/mermaidCleanup";
import { sanitizeMermaidSource } from "@/lib/mermaidSource";
import { cn } from "@/lib/utils";

/**
 * Renders a Mermaid diagram to inline SVG. The library (~600 KB) loads only when a diagram is on
 * screen. A `Source` toggle shows the text the agent wrote; a failed parse falls back to it.
 */
let counter = 0;

export function MermaidBlock({ code, className }: { code: string; className?: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSvg(null); setError(null);
    import("mermaid")
      .then(async ({ default: mermaid }) => {
        // suppressErrorRendering: without it, a failed parse makes Mermaid drop its own "bomb" error
        // SVG straight onto document.body before throwing - outside React's tree, so nothing (not our
        // catch below, not unmount, not route navigation) ever removes it; it just sits there on every
        // page until a full reload. Our catch already renders a proper inline fallback, so nothing is lost.
        mermaid.initialize({
          startOnLoad: false,
          theme: "base",
          securityLevel: "strict",
          fontFamily: "Inter, system-ui, sans-serif",
          themeVariables: {
            fontSize: "13px",
            primaryColor: "#EEF0FF",
            primaryTextColor: "#1F2937",
            primaryBorderColor: "#6366F1",
            lineColor: "#6366F1",
            secondaryColor: "#F4F5F8",
            secondaryBorderColor: "#D8DAE5",
            tertiaryColor: "#FFFFFF",
            tertiaryBorderColor: "#D8DAE5",
          },
          suppressErrorRendering: true,
        });
        counter += 1;
        const { svg: rendered } = await mermaid.render(`nc-mermaid-${counter}`, sanitizeMermaidSource(code));
        if (!cancelled) setSvg(rendered);
      })
      .catch((cause: unknown) => {
        // Belt and suspenders: suppressErrorRendering should already stop mermaid from touching
        // document.body on a failed parse, but sweep anyway in case this ever runs against a build
        // or code path where that flag was not honoured.
        sweepOrphanedMermaidElements();
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => { cancelled = true; };
  }, [code]);

  return (
    <figure className={cn("my-3 overflow-hidden rounded-xl border border-line bg-raised", className)}>
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-1.5">
        <span className="text-[12px] font-medium text-ink-5">Diagram</span>
        <button type="button" className="text-[12.5px] font-medium text-ink-4 hover:text-ink-1" onClick={() => setShowSource((value) => !value)}>{showSource ? "Diagram" : "Source"}</button>
      </div>
      {showSource || error ? (
        <div className="p-3">
          {error ? <p className="mb-2 text-[13px] text-rose-700">The diagram could not be drawn: {error}</p> : null}
          <CodeBlock code={code} language="mermaid" maxHeight={360} />
        </div>
      ) : svg ? (
        // Mermaid renders with securityLevel "strict", which sanitises the SVG it returns.
        // eslint-disable-next-line react/no-danger
        <div className="mermaid-svg overflow-x-auto p-4 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <div className="space-y-2 p-4"><Skeleton className="h-3 w-1/2" /><Skeleton className="h-24 w-full" /></div>
      )}
    </figure>
  );
}

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { CopyButton } from "@/components/ui/copy-button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const COLLAPSED_MAX_HEIGHT = "8.5rem";

export interface CodeBlockProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  code: string;
  /** Display label only, e.g. `sql` or `json`. No syntax highlighting is applied. */
  language?: string;
  maxHeight?: number | string;
  /** Adds an expand/collapse control that clamps the block height. */
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  showLineNumbers?: boolean;
  copyLabel?: string;
}

const CodeBlock = React.forwardRef<HTMLDivElement, CodeBlockProps>(
  (
    {
      className,
      code,
      language,
      maxHeight = 320,
      collapsible = false,
      defaultCollapsed = true,
      showLineNumbers = false,
      copyLabel = "Copy code",
      ...props
    },
    ref,
  ) => {
    const [collapsed, setCollapsed] = React.useState<boolean>(collapsible && defaultCollapsed);
    const bodyId = React.useId();

    const lines = React.useMemo(() => code.replace(/\n$/, "").split("\n"), [code]);
    const isCollapsed = collapsible && collapsed;

    return (
      <div
        ref={ref}
        className={cn("overflow-hidden rounded-xl border border-raised/10 bg-brand-dark", className)}
        {...props}
      >
        <div className="flex items-center justify-between gap-2 border-b border-raised/10 px-3 py-1.5">
          <span className="truncate text-[11.5px] font-semibold uppercase tracking-[0.05em] text-white/45">
            {language ?? "code"}
          </span>
          <div className="flex shrink-0 items-center gap-1">
            {collapsible ? (
              <button
                type="button"
                aria-expanded={!isCollapsed}
                aria-controls={bodyId}
                onClick={() => setCollapsed((current) => !current)}
                className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11.5px] font-semibold tracking-normal text-white/60 transition-colors hover:bg-raised/10 hover:text-white focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                {isCollapsed ? `Expand ${lines.length} lines` : "Collapse"}
                <ChevronDown
                  className={cn("h-3.5 w-3.5 transition-transform duration-200", !isCollapsed && "rotate-180")}
                  aria-hidden="true"
                />
              </button>
            ) : null}
            <CopyButton
              value={code}
              label={copyLabel}
              className="text-white/60 hover:bg-raised/10 hover:text-white"
            />
          </div>
        </div>

        <div className="relative">
          <ScrollArea
            id={bodyId}
            orientation="both"
            tone="dark"
            maxHeight={isCollapsed ? COLLAPSED_MAX_HEIGHT : maxHeight}
            className={cn(isCollapsed && "overflow-hidden")}
          >
            <div className="flex w-max min-w-full">
              {showLineNumbers ? (
                <div
                  aria-hidden="true"
                  className="sticky left-0 z-10 select-none border-r border-raised/10 bg-brand-dark px-2.5 py-3 text-right font-mono text-[12.5px] leading-5 text-white/25"
                >
                  {lines.map((_line, index) => (
                    <div key={`line-${index + 1}`}>{index + 1}</div>
                  ))}
                </div>
              ) : null}
              <pre className="min-w-max px-3 py-3 font-mono text-[12.5px] leading-5 tracking-normal text-slate-100">
                <code>{lines.join("\n")}</code>
              </pre>
            </div>
          </ScrollArea>
          {isCollapsed ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-brand-dark to-transparent"
            />
          ) : null}
        </div>
      </div>
    );
  },
);
CodeBlock.displayName = "CodeBlock";

export { CodeBlock };

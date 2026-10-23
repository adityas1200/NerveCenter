import { Globe, Mail, Plug, SquareTerminal } from "lucide-react";
import { brandMark, type BrandMark } from "@/components/ops/BrandLogo";
import { cn } from "@/lib/utils";

/**
 * 28px mark for a connector card. Known systems show their brand mark in the brand colour (brand
 * logos are one of the few places colour is allowed); everything else is a monochrome glyph for how
 * the agent reaches it: a plug for an MCP server, a globe for a REST API, a terminal for a command.
 */

function brandFor(id: string, command?: string): BrandMark | undefined {
  return brandMark(id) ?? (command ? brandMark(command.split(/\s+/)[0]) : undefined);
}

export function ConnectorLogo({ id, kind, connectionKind, command, className }: { id: string; kind: "catalog" | "custom"; connectionKind?: string; command?: string; className?: string }) {
  const brand = brandFor(id, kind === "custom" && connectionKind === "cli" ? command : undefined);
  if (brand) {
    return (
      <svg viewBox={brand.viewBox ?? "0 0 24 24"} width={28} height={28} className={cn("shrink-0", className)} aria-hidden="true" focusable="false" data-brand={id}>
        <path d={brand.path} fill={`#${brand.hex}`} fillRule="evenodd" />
      </svg>
    );
  }
  const Glyph = connectionKind === "api" ? Globe : connectionKind === "cli" ? SquareTerminal : connectionKind === "smtp" ? Mail : Plug;
  return (
    <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center text-ink-1", className)} aria-hidden="true">
      <Glyph className="h-5 w-5" strokeWidth={1.75} />
    </span>
  );
}

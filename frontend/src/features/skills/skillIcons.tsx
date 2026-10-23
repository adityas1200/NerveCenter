/* eslint-disable react-refresh/only-export-components -- style lookup and icon component intentionally share one catalog */
import {
  BookOpen,
  Compass,
  Database,
  FileText,
  MessageSquare,
  Pencil,
  Radar,
  Search,
  Settings2,
  ShieldCheck,
  Puzzle,
  Ticket,
  Waypoints,
  Wrench,
  type LucideIcon,
} from "lucide-react";

/**
 * One small icon per built-in skill, so the grid reads at a glance. The glyph carries the meaning;
 * the chip is neutral (colour in this app is kept for status, priority and numbers). Keyed by the
 * skill's folder name (`rca`, `tickets`, …), not its `plugin:`/`custom:` id, so a custom skill that
 * happens to share a name still gets a sensible default via the fallback below.
 */
export interface SkillIconStyle { icon: LucideIcon; className: string }

const NEUTRAL = "border border-line bg-surface-panel text-ink-3";

const DEFAULT_ICON: SkillIconStyle = { icon: Puzzle, className: NEUTRAL };

const SKILL_ICONS: Record<string, SkillIconStyle> = {
  access: { icon: ShieldCheck, className: NEUTRAL },
  build: { icon: Wrench, className: NEUTRAL },
  communication: { icon: MessageSquare, className: NEUTRAL },
  "data-pull": { icon: Database, className: NEUTRAL },
  documents: { icon: FileText, className: NEUTRAL },
  knowledge: { icon: BookOpen, className: NEUTRAL },
  monitoring: { icon: Radar, className: NEUTRAL },
  orchestrate: { icon: Compass, className: NEUTRAL },
  rca: { icon: Search, className: NEUTRAL },
  remediation: { icon: Wrench, className: NEUTRAL },
  research: { icon: Search, className: NEUTRAL },
  setup: { icon: Settings2, className: NEUTRAL },
  tickets: { icon: Ticket, className: NEUTRAL },
  unslop: { icon: Pencil, className: NEUTRAL },
  verification: { icon: ShieldCheck, className: NEUTRAL },
  workflow: { icon: Waypoints, className: NEUTRAL },
};

export function skillIconStyle(name: string): SkillIconStyle {
  return SKILL_ICONS[name.toLowerCase()] || DEFAULT_ICON;
}

/** The small rounded icon chip itself, ready to drop next to a skill's name. */
export function SkillIcon({ name, size = "sm" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const { icon: Icon, className } = skillIconStyle(name);
  const box = size === "lg" ? "h-11 w-11 rounded-xl" : size === "md" ? "h-10 w-10 rounded-xl" : "h-8 w-8 rounded-lg";
  const glyph = size === "sm" ? "h-4 w-4" : "h-5 w-5";
  return (
    <span className={`flex shrink-0 items-center justify-center ${box} ${className}`} aria-hidden="true">
      <Icon className={glyph} />
    </span>
  );
}

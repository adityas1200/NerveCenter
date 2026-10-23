import { cn } from "@/lib/utils";

/**
 * A person as initials in a soft tint. The tint comes from the name, so one person keeps one colour
 * on every screen and a column of owners scans by colour before it is read. Tints are the quiet
 * 100/700 steps of the theme palette, so they hold in both themes and never read as a status.
 */

const TINTS = [
  "bg-indigo-100 text-indigo-700",
  "bg-sky-100 text-sky-700",
  "bg-teal-100 text-teal-700",
  "bg-violet-100 text-violet-700",
  "bg-amber-100 text-amber-800",
  "bg-fuchsia-100 text-fuchsia-700",
  "bg-cyan-100 text-cyan-700",
  "bg-orange-100 text-orange-700",
];

const initialsOf = (name: string) => name.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("") || "?";

function tintOf(name: string): string {
  let hash = 0;
  for (const char of name.toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return TINTS[hash % TINTS.length];
}

export function PersonAvatar({ name, size = 22, className }: { name: string; size?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-grid shrink-0 place-items-center rounded-full font-semibold leading-none", tintOf(name), className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
    >
      {initialsOf(name)}
    </span>
  );
}

/** Avatar and name on one line, for owner and assignee cells. */
export function PersonName({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cn("inline-flex min-w-0 max-w-full items-center gap-2", className)} title={name}>
      <PersonAvatar name={name} />
      <span className="truncate">{name}</span>
    </span>
  );
}

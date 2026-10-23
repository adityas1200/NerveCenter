/**
 * @ mentions in the message box: the person types @ and picks a ticket, pipeline or table; the text
 * keeps "@label" and the record travels with the message as page context (`mentions`), so Sonic reads
 * exactly that record instead of guessing from a name.
 */
export type MentionKind = "ticket" | "pipeline" | "table";

export interface Mention {
  kind: MentionKind;
  /** The id Sonic looks the record up by: ticket id, pipeline id, fully qualified table name. */
  id: string;
  /** What is typed after the @, e.g. INC0012, veltrix_sales_daily_load, commercial.silver.sales_fact. */
  label: string;
  title?: string;
  /** Short grey text on the right of the row, e.g. the ticket status or the platform. */
  meta?: string;
  /** Extra text matched by the search but not shown, e.g. a ticket's pipeline name. */
  keywords?: string;
}

/** The DOM id of a row in the @ menu, for the box's aria-activedescendant. */
export const mentionOptionId = (mention: Mention) => `mention-${mention.kind}-${mention.id}`.replace(/[^\w-]/g, "_");

export const MENTION_GROUP: Record<MentionKind, string> = { ticket: "Tickets", pipeline: "Pipelines", table: "Tables" };

/** The @word being typed right before the caret, or null. An @ only starts a mention at the start or after a space. */
export function mentionAt(text: string, caret: number): { start: number; term: string } | null {
  const match = /(^|\s)@([^\s@]*)$/.exec(text.slice(0, caret));
  if (!match) return null;
  return { start: caret - match[2].length - 1, term: match[2] };
}

/** Replace the @word being typed with "@label " and return the new text and caret. */
export function insertMention(text: string, start: number, caret: number, label: string): { text: string; caret: number } {
  const inserted = `@${label} `;
  const rest = text.slice(caret).replace(/^\S*/, "").replace(/^ /, "");
  return { text: `${text.slice(0, start)}${inserted}${rest}`, caret: start + inserted.length };
}

/** The picked mentions still written in the text, once each. Deleting "@INC0012" from the box drops that ticket. */
export function mentionsIn(text: string, picked: Mention[]): Mention[] {
  const seen = new Set<string>();
  return picked.filter((mention) => {
    const key = `${mention.kind}:${mention.id}`;
    if (seen.has(key) || !new RegExp(`(^|\\s)@${escapeRegExp(mention.label)}(?=$|[\\s.,;:!?)])`).test(text)) return false;
    seen.add(key);
    return true;
  });
}

const PER_GROUP = 4;

/**
 * Rank candidates for what was typed after the @: label prefix first, then anywhere in the label, then
 * the title and keywords. At most four per kind, kinds in the order tickets, pipelines, tables.
 * With nothing typed yet the first candidates of each kind show (callers pass the most useful first).
 */
export function rankMentions(term: string, candidates: Mention[]): Mention[] {
  const needle = term.trim().toLowerCase();
  const scored = candidates
    .map((mention, index) => ({ mention, index, score: scoreOf(needle, mention) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const out: Mention[] = [];
  for (const kind of Object.keys(MENTION_GROUP) as MentionKind[]) out.push(...scored.filter((entry) => entry.mention.kind === kind).slice(0, PER_GROUP).map((entry) => entry.mention));
  return out;
}

function scoreOf(needle: string, mention: Mention): number {
  if (!needle) return 1;
  const label = mention.label.toLowerCase();
  if (label === needle) return 5;
  if (label.startsWith(needle)) return 4;
  // Table names are matched on their last part too: "sales" finds commercial.silver.sales_fact.
  if (label.split(".").some((part) => part.startsWith(needle))) return 3.5;
  if (label.includes(needle)) return 3;
  if ((mention.title || "").toLowerCase().includes(needle) || (mention.keywords || "").toLowerCase().includes(needle)) return 2;
  return 0;
}

/** A typed two- or three-part name the platform search did not return is still offered as a table. */
export function typedTable(term: string): Mention | null {
  return /^[\w$-]+(\.[\w$-]+){1,2}$/.test(term) ? { kind: "table", id: term, label: term, meta: "Use this name" } : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

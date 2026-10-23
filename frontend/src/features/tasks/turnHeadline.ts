/**
 * SPEC-tasks-10 FR-6: a finished turn that drew components opens with its answer. The headline is the
 * reply's first sentence when the reply starts with a plain paragraph; a heading, list, table, quote or
 * code block first means the reply has no headline and stays whole below the components.
 */
export function splitHeadline(text: string): { headline: string; rest: string } | null {
  const trimmed = text.trim();
  if (!trimmed || /^(#|[-*+] |\d+[.)] |>|\||```|~~~|:::|<)/.test(trimmed)) return null;
  const paragraph = trimmed.split(/\n\s*\n/)[0];
  // A paragraph that wraps across lines is still one paragraph; a line break that starts a list is not.
  if (/\n\s*([-*+] |\d+[.)] |\|)/.test(paragraph)) return null;
  const flat = paragraph.replace(/\s*\n\s*/g, " ");
  // The first full stop, question or exclamation mark followed by a space and a capital, a backtick, an
  // asterisk or a digit; "v1.2", "e.g. the" and "11,982." mid-number do not end a sentence.
  const end = /[.!?](?=\s+[A-Z`*0-9"(])/.exec(flat);
  const headline = (end ? flat.slice(0, end.index + 1) : flat).trim();
  if (headline.length < 12 || headline.length > 320) return null;
  const rest = trimmed.slice(trimmed.indexOf(paragraph) + paragraph.length).trim();
  const tail = end ? flat.slice(end.index + 1).trim() : "";
  return { headline, rest: [tail, rest].filter(Boolean).join("\n\n") };
}

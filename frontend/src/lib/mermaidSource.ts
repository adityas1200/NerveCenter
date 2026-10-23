/**
 * Mechanical fixes only - never changes what the diagram means, only paste/typography artifacts
 * Mermaid's parser is strict about: a smart quote from a pasted source, or a stray code-fence line
 * if one ever leaked through from upstream extraction. Real syntax mistakes (an unquoted label with
 * punctuation, the reserved word `end`) are the agent's to get right - see reply-format.md.
 */
export function sanitizeMermaidSource(source: string): string {
  const cleaned = source
    .replace(/^```(?:mermaid)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\u00A0/g, " ")
    .trim();
  return escapeTimelineColons(cleaned);
}

/**
 * In a `timeline`, ":" followed by whitespace is the period/event separator, and any other ":" is
 * a parse error - so a clock time like `2026-09-30 10:34 : Run timed out` breaks the whole diagram.
 * Swap every colon that is not a separator for the look-alike ratio sign (U+2236) so the text still
 * reads "10:34". Other diagram types are left alone.
 */
const RATIO_SIGN = "∶";

function escapeTimelineColons(source: string): string {
  const lines = source.split("\n");
  let index = 0;
  if (lines[0]?.trim() === "---") {
    // YAML front matter: skip to its closing fence.
    index = lines.findIndex((line, i) => i > 0 && line.trim() === "---") + 1;
    if (index === 0) return source;
  }
  while (index < lines.length && (lines[index].trim() === "" || lines[index].trim().startsWith("%%"))) index += 1;
  if (!/^\s*timeline\b/i.test(lines[index] ?? "")) return source;
  for (let i = index + 1; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("%%") || /^acc(Title|Descr)\b/.test(trimmed)) continue;
    lines[i] = lines[i].replace(/:(?=\S)/g, RATIO_SIGN);
  }
  return lines.join("\n");
}

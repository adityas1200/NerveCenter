/** Split a markdown document into its YAML-ish frontmatter (flat key: value lines) and body. */
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function splitFrontmatter(text: string): { meta: Array<[string, string]>; body: string } {
  const match = FRONTMATTER.exec(text);
  if (!match) return { meta: [], body: text };
  const meta: Array<[string, string]> = [];
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (pair) meta.push([pair[1], pair[2].replace(/^['"]|['"]$/g, "")]);
    else if (meta.length && /^\s+\S/.test(line)) meta[meta.length - 1][1] = `${meta[meta.length - 1][1]} ${line.trim()}`.trim();
  }
  return { meta, body: text.slice(match[0].length) };
}

export function formatBytes(size?: number): string {
  if (size === undefined || size === null) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export type FrontmatterValue = string | string[] | Array<[string, string]>;
export interface FrontmatterDoc { properties: Array<[string, FrontmatterValue]>; body: string }

/**
 * Frontmatter for display: top-level keys with a scalar, a list (`[a, b]` or `- a` lines), a
 * one-level mapping (`verified:` with `by:` and `at:` under it) or a block scalar (`|`, `>`).
 * Not a full YAML parser; anything deeper is flattened to text.
 */
export function parseFrontmatter(text: string): FrontmatterDoc {
  const match = FRONTMATTER.exec(text);
  if (!match) return { properties: [], body: text };
  const lines = match[1].split(/\r?\n/);
  const properties: Array<[string, FrontmatterValue]> = [];
  let index = 0;
  while (index < lines.length) {
    const pair = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(lines[index]);
    index += 1;
    if (!pair) continue;
    const [, key, rest] = pair;
    const nested: string[] = [];
    while (index < lines.length && (/^\s+\S/.test(lines[index]) || /^-\s/.test(lines[index]) || !lines[index].trim())) { nested.push(lines[index]); index += 1; }
    const inner = nested.filter((line) => line.trim());
    const value = rest.trim();
    if (/^[|>][+-]?$/.test(value)) { properties.push([key, inner.map((line) => line.trim()).join(value.startsWith(">") ? " " : "\n")]); continue; }
    if (value) { properties.push([key, scalarOrList(value)]); continue; }
    if (inner.length && inner.every((line) => /^\s*-\s/.test(line))) { properties.push([key, inner.map((line) => unquote(line.replace(/^\s*-\s+/, "")))]); continue; }
    if (inner.length) {
      const entries: Array<[string, string]> = [];
      for (const line of inner) {
        const sub = /^\s*([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
        if (sub) entries.push([sub[1], unquote(sub[2])]);
        else if (entries.length) entries[entries.length - 1][1] = `${entries[entries.length - 1][1]} ${line.trim()}`.trim();
      }
      properties.push([key, entries]);
      continue;
    }
    properties.push([key, ""]);
  }
  return { properties, body: text.slice(match[0].length) };
}

function scalarOrList(value: string): string | string[] {
  const list = /^\[(.*)\]$/.exec(value);
  if (list) return list[1].split(",").map((item) => unquote(item)).filter(Boolean);
  return unquote(value);
}

function unquote(value: string): string {
  return value.trim().replace(/^(['"])([\s\S]*)\1$/, "$2");
}

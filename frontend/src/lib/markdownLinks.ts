/**
 * Links inside markdown files that live in a folder (a knowledge base, a skill). A relative link is
 * resolved against the directory of the file it appears in, the way GitHub resolves it, so
 * `../index.md`, `./a.md`, `folder/file.md#section` and a bare folder all land on the right file.
 */

export type ResolvedLink =
  | { kind: "external"; href: string }
  | { kind: "anchor"; anchor: string }
  | { kind: "file"; path: string; anchor?: string }
  /** Climbs above the folder's root (`../../elsewhere.md` from the root). */
  | { kind: "outside"; href: string };

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

export function isExternalHref(href: string): boolean {
  return EXTERNAL.test(href.trim());
}

/** Resolve `href` as written in the file at `fromPath` (a path relative to the folder root, e.g. `runbooks/index.md`). */
export function resolveLink(fromPath: string, href: string): ResolvedLink {
  const raw = href.trim();
  if (isExternalHref(raw)) return { kind: "external", href: raw };
  const hashAt = raw.indexOf("#");
  const target = hashAt >= 0 ? raw.slice(0, hashAt) : raw;
  const anchor = hashAt >= 0 ? safeDecode(raw.slice(hashAt + 1)) : "";
  const pathPart = target.split("?")[0];
  if (!pathPart) return anchor ? { kind: "anchor", anchor } : { kind: "anchor", anchor: "" };
  const decoded = safeDecode(pathPart);
  const baseParts = decoded.startsWith("/") ? [] : fromPath.split("/").slice(0, -1);
  const parts = [...baseParts];
  for (const segment of decoded.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!parts.length) return { kind: "outside", href: raw };
      parts.pop();
    } else parts.push(segment);
  }
  const path = parts.join("/");
  return anchor ? { kind: "file", path, anchor } : { kind: "file", path };
}

/**
 * A link or image in a task file. Agents write `tasks/<id>/x.md` or `/x.md` for the task folder itself; anything
 * else is relative to the file's own folder, so `l2-model.md` in `pipeline-and-dq/index.md` is `pipeline-and-dq/l2-model.md`.
 * Null when it climbs above the task folder.
 */
export function resolveTaskFileLink(fromPath: string, href: string): string | null {
  const raw = href.trim();
  const rooted = /^(?:\/|tasks\/[^/]+\/)/.test(raw);
  const link = resolveLink(rooted ? "" : fromPath, raw.replace(/^tasks\/[^/]+\//, ""));
  return link.kind === "file" ? link.path : null;
}

/**
 * A file named in a chat reply, matched to the task's files (`paths`, relative to the task folder). Sonic's cwd is the
 * project workspace, so it writes `tasks/<id>/x.md`, an absolute path ending in `tasks/<id>/x.md`, or the bare name of a
 * file it saved in a subfolder. The exact path wins, then the one file whose path ends with the link; an ambiguous or
 * unknown link comes back cleaned but unmatched, so the viewer says it is missing instead of guessing.
 */
export function resolveChatFileLink(href: string, taskId: string, paths: readonly string[]): string {
  const id = taskId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const cleaned = safeDecode(href.trim().replace(/^file:\/\//i, "").split(/[?#]/)[0]);
  const inTask = cleaned.match(new RegExp(`(?:^|/)tasks/${id}/(.+)$`));
  const path = (inTask ? inTask[1] : cleaned).replace(/^(?:\.\/|\/)+/, "");
  if (paths.includes(path)) return path;
  const endsWith = paths.filter((candidate) => candidate.endsWith(`/${path}`));
  return endsWith.length === 1 ? endsWith[0] : path;
}

/** GitHub-style heading slug: lower case, punctuation dropped, spaces to dashes. */
export function headingSlug(text: string): string {
  return text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-");
}

function safeDecode(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

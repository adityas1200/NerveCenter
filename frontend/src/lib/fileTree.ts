import type { TreeNode } from "@/api/library";

/** First file worth opening: a preferred name at the root, else the first markdown file, else the first file. */
export function defaultFile(nodes: TreeNode[], preferred: string[]): string | null {
  for (const name of preferred) { const hit = nodes.find((node) => node.type === "file" && node.name.toLowerCase() === name.toLowerCase()); if (hit) return hit.path; }
  const flat: TreeNode[] = []; const walk = (items: TreeNode[]) => { for (const item of items) { if (item.type === "file") flat.push(item); else walk(item.children || []); } }; walk(nodes);
  return flat.find((node) => /\.md$/i.test(node.name))?.path || flat[0]?.path || null;
}

/** The node at `path`, or null. The root itself is `""`. */
export function findNode(nodes: TreeNode[], path: string): TreeNode | null {
  const parts = path.split("/").filter(Boolean);
  let level = nodes; let found: TreeNode | null = null;
  for (const part of parts) {
    found = level.find((node) => node.name === part) || null;
    if (!found) return null;
    level = found.children || [];
  }
  return found;
}

/**
 * The file a link should open: the file itself; for a folder, its index.md or README.md (else its
 * first markdown file); for a path without an extension, the same path plus `.md`. Null when nothing matches.
 */
export function resolveTreeTarget(nodes: TreeNode[], path: string): string | null {
  const clean = path.replace(/\/+$/, "");
  if (!clean) return defaultFile(nodes, ["index.md", "README.md", "SKILL.md"]);
  const node = findNode(nodes, clean);
  if (node?.type === "file") return node.path;
  if (node?.type === "directory") return defaultFile(node.children || [], ["index.md", "README.md"]);
  if (!/\.[a-z0-9]+$/i.test(clean)) { const withExtension = findNode(nodes, `${clean}.md`); if (withExtension?.type === "file") return withExtension.path; }
  return null;
}

/** Folders that contain `path`, outermost first: `a/b/c.md` → `a`, `a/b`. */
export function ancestorsOf(path: string): string[] {
  const parts = path.split("/").slice(0, -1);
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}

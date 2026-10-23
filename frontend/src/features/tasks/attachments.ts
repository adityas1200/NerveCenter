import { fileToBase64 } from "@/api/library";
import type { AttachmentUpload } from "@/api/tasks";
import { formatBytes } from "@/lib/frontmatter";

/**
 * Files a person attaches to a message (SPEC-tasks-11). The types are the ones Sonic can read, with Read or,
 * for Office files and meeting transcripts, the plugin's extraction (SPEC-knowledge-03 FR-4); the limits
 * mirror the backend (backend/src/tasks/attachments.mjs), which checks them again.
 */
export const ATTACHMENT_LIMITS = { files: 10, fileBytes: 10 * 1024 * 1024, totalBytes: 25 * 1024 * 1024 };
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp"];
const FILE_EXTENSIONS = ["pdf", "docx", "xlsx", "pptx", "vtt", "txt", "md", "csv", "tsv", "json", "yaml", "yml", "sql", "log"];
const EXTENSIONS = [...IMAGE_EXTENSIONS, ...FILE_EXTENSIONS];
const accept = (extensions: string[]) => extensions.map((ext) => `.${ext}`).join(",");
/** What the + menu's two pickers offer; the system file dialog greys out everything else. */
export const IMAGE_ACCEPT = accept(IMAGE_EXTENSIONS);
export const FILE_ACCEPT = accept(FILE_EXTENSIONS);
const extension = (name: string) => { const dot = name.lastIndexOf("."); return dot > 0 ? name.slice(dot + 1).toLowerCase() : ""; };
export const isImageName = (name: string) => /\.(png|jpe?g|gif|webp)$/i.test(name);

/** Add `incoming` to `current` (FR-2): files Sonic cannot read or over the limits are left out, and each problem is named. */
export function addAttachments(current: File[], incoming: File[]): { files: File[]; problems: string[] } {
  const files = [...current]; const problems: string[] = [];
  let total = files.reduce((sum, file) => sum + file.size, 0);
  for (const file of incoming) {
    if (!EXTENSIONS.includes(extension(file.name))) { problems.push(`${file.name} can't be attached. Use an image, a PDF, a Word, Excel or PowerPoint file, a meeting transcript (.vtt) or a text file (CSV, JSON, YAML, SQL, markdown, log).`); continue; }
    if (file.size === 0) { problems.push(`${file.name} is empty.`); continue; }
    if (file.size > ATTACHMENT_LIMITS.fileBytes) { problems.push(`${file.name} is ${formatBytes(file.size)}; a file can be at most ${formatBytes(ATTACHMENT_LIMITS.fileBytes)}.`); continue; }
    if (files.length >= ATTACHMENT_LIMITS.files) { problems.push(`A message can hold at most ${ATTACHMENT_LIMITS.files} files.`); break; }
    if (total + file.size > ATTACHMENT_LIMITS.totalBytes) { problems.push(`${file.name} would take the message over ${formatBytes(ATTACHMENT_LIMITS.totalBytes)}. Send it in another message.`); continue; }
    files.push(file); total += file.size;
  }
  return { files, problems };
}

export async function toAttachmentUploads(files: File[]): Promise<AttachmentUpload[]> {
  return Promise.all(files.map(async (file) => ({ name: file.name, data: await fileToBase64(file) })));
}

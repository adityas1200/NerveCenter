import { fileToBase64, UPLOAD_LIMITS, type UploadDocument } from "@/api/library";

/** Checks and conversions for uploaded documents. The limits mirror the backend (knowledge-service.mjs). */

const EXTENSIONS = new Set(UPLOAD_LIMITS.accept.split(","));
const extension = (name: string) => { const dot = name.lastIndexOf("."); return dot > 0 ? name.slice(dot).toLowerCase() : ""; };

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** What is wrong with a selection, in plain words, or null when it can be uploaded. */
export function uploadProblem(files: File[]): string | null {
  if (!files.length) return null;
  if (files.length > UPLOAD_LIMITS.files) return `Choose at most ${UPLOAD_LIMITS.files} documents at a time.`;
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > UPLOAD_LIMITS.bytes) return `${formatBytes(total)} is more than the ${formatBytes(UPLOAD_LIMITS.bytes)} an upload can hold. Upload them in smaller batches.`;
  const empty = files.find((file) => file.size === 0);
  if (empty) return `${empty.name} is empty.`;
  return null;
}

export async function toUploads(files: File[]): Promise<UploadDocument[]> {
  return Promise.all(files.map(async (file) => ({ name: file.name, data: await fileToBase64(file) })));
}

/** Add `incoming` to `current`: unsupported types are left out (and named), a file with the same name replaces the earlier one. */
export function mergeFiles(current: File[], incoming: File[]): { files: File[]; skipped: string[] } {
  const skipped = incoming.filter((file) => !EXTENSIONS.has(extension(file.name))).map((file) => file.name);
  const accepted = incoming.filter((file) => EXTENSIONS.has(extension(file.name)));
  const names = new Set(accepted.map((file) => file.name.toLowerCase()));
  return { files: [...current.filter((file) => !names.has(file.name.toLowerCase())), ...accepted], skipped };
}

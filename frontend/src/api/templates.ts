import { apiClient } from "@/api/client";

/**
 * Client document templates (Settings > Templates): one active choice per format, either a
 * built-in preset or a file an admin uploaded. The choice itself lives in operations.yaml's
 * `documents` section (read and saved through the settings API); this module only lists the
 * built-in presets and uploads a custom file.
 */

export type TemplateFormat = "word" | "ppt" | "html";
export const TEMPLATE_FORMATS: TemplateFormat[] = ["word", "ppt", "html"];
export const TEMPLATE_FORMAT_LABEL: Record<TemplateFormat, string> = { word: "Word", ppt: "PowerPoint", html: "HTML" };
export const TEMPLATE_FORMAT_ACCEPT: Record<TemplateFormat, string> = { word: ".docx", ppt: ".pptx", html: ".html,.htm" };

export interface TemplatePreset { id: string; name: string; description: string }
export type TemplatePresets = Record<TemplateFormat, TemplatePreset[]>;

/** What's saved in operations.yaml for one format: a built-in preset, or the file last uploaded for it. */
export type TemplateChoice =
  | { kind: "preset"; id: string }
  | { kind: "custom"; fileName: string; originalName?: string | null; uploadedAt?: string; uploadedBy?: string | null };

export interface DocumentsSettings { templates?: Partial<Record<TemplateFormat, TemplateChoice>> }

export interface TemplateUploadResult { format: TemplateFormat; kind: "custom"; fileName: string; originalName: string | null; uploadedAt: string; uploadedBy: string | null }

export const templatesApi = {
  presets: (signal?: AbortSignal) => apiClient.get<{ presets: TemplatePresets }>("/api/templates", { signal }),
  upload: (format: TemplateFormat, fileBase64: string, fileName: string) => apiClient.post<TemplateUploadResult>("/api/templates/upload", { format, fileBase64, fileName }),
};

import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureDir, safeJoin } from '../lib/fs.mjs';

/**
 * Client document templates: one active choice per format (word, ppt, html), stored in
 * operations.yaml under `documents.templates`. Each choice is either a built-in preset (named here,
 * no branded file behind it yet) or a file an admin uploaded through this service. Having Sonic
 * actually start a new document from the active choice is a later step; this only stores the pick
 * and keeps the uploaded file, the same way Skills' zip upload keeps a skill's files.
 */

export const TEMPLATE_FORMATS = ['word', 'ppt', 'html'];
export type TemplateFormat = 'word'|'ppt'|'html';
type TemplateWorkspace = {templatesDir:string};
type TemplateUser = {id?:string|null};
type TemplateUpload = {format?:string;fileBase64?:string;fileName?:string;user?:TemplateUser}|undefined;
export type UploadedTemplate = {format:TemplateFormat;kind:'custom';fileName:string;originalName:string|null;uploadedAt:string;uploadedBy:string|null};
type TemplatePresets = Record<TemplateFormat,Array<{id:string;name:string;description:string}>>;

const EXTENSIONS:Record<TemplateFormat,string[]> = { word: ['.docx'], ppt: ['.pptx'], html: ['.html', '.htm'] };

/** Placeholder presets: name and description only. Swap in a real file per preset when the actual branded templates are ready. */
export const PRESETS = {
  word: [
    { id: 'plain', name: 'Plain', description: 'A minimal, unbranded document.' },
    { id: 'formal-report', name: 'Formal report', description: 'A cover page, headings and a table of contents.' },
    { id: 'short-brief', name: 'Short brief', description: 'A single page, no cover page.' },
  ],
  ppt: [
    { id: 'plain', name: 'Plain', description: 'A minimal, unbranded deck.' },
    { id: 'title-content', name: 'Title + content', description: 'One title and one content area per slide.' },
    { id: 'executive-summary', name: 'Executive summary', description: 'A cover slide, then one slide per section.' },
  ],
  html: [
    { id: 'plain', name: 'Plain', description: 'A minimal, unbranded page.' },
    { id: 'report-page', name: 'Report page', description: 'Headings, tables and inline charts.' },
    { id: 'email-safe', name: 'Email-safe', description: 'Inline styles only, safe for email clients.' },
  ],
};

const MAX_BYTES = 20 * 1024 * 1024;
const safeFileName = (name:string|undefined) => String(name || '').replace(/[^\w.\-]+/g, '-').slice(-80);

export class TemplateService {
  workspace:TemplateWorkspace;
  constructor({ workspace }: {workspace:TemplateWorkspace}) { this.workspace = workspace; }

  /** The built-in choices per format, for the picker. */
  presets():TemplatePresets { return PRESETS; }

  /** Save an uploaded file as the custom template for one format. Replaces any earlier upload for that format. */
  async upload({ format, fileBase64, fileName, user }:TemplateUpload = {}):Promise<UploadedTemplate> {
    if (!TEMPLATE_FORMATS.includes(format as TemplateFormat)) throw new Error(`format must be one of ${TEMPLATE_FORMATS.join(', ')}`);
    const selectedFormat = format as TemplateFormat;
    if (!fileBase64 || typeof fileBase64 !== 'string') throw new Error('fileBase64 is required');
    const extension = path.extname(String(fileName || '')).toLowerCase();
    if (!EXTENSIONS[selectedFormat].includes(extension)) throw new Error(`A ${selectedFormat} template must be a ${EXTENSIONS[selectedFormat].join(' or ')} file`);
    const buffer = Buffer.from(fileBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');
    if (!buffer.length) throw new Error('The file is empty');
    if (buffer.length > MAX_BYTES) throw new Error('The file is larger than 20 MB');
    const dir = path.join(this.workspace.templatesDir, selectedFormat);
    await ensureDir(dir);
    // One upload per format: clear whatever was there before so the folder never accumulates old files.
    for (const existing of await fs.readdir(dir).catch(() => [])) await fs.rm(path.join(dir, existing), { force: true });
    const savedName = `${Date.now()}-${safeFileName(fileName) || `template${extension}`}`;
    await fs.writeFile(safeJoin(dir, savedName), buffer);
    return { format: selectedFormat, kind: 'custom', fileName: savedName, originalName: fileName || null, uploadedAt: new Date().toISOString(), uploadedBy: user?.id || null };
  }
}

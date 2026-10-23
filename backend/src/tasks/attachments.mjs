import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.mjs';
import { httpError } from '../lib/util.mjs';
import { safeJoin } from '../lib/fs.mjs';
import { safeDocumentName } from '../knowledge/knowledge-service.mjs';

// Files a person attaches to a message (SPEC-tasks-11). They are saved in the task folder and the
// agent opens them with Read, which reads images and PDFs itself. Word, Excel and PowerPoint files and meeting
// transcripts come for knowledge setup (SPEC-knowledge-03 FR-4); Office files are read with the document extraction.
const TYPES = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf',
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', tsv: 'text/tab-separated-values', json: 'application/json',
  yaml: 'text/yaml', yml: 'text/yaml', sql: 'text/plain', log: 'text/plain', vtt: 'text/vtt',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
const OFFICE = new Set(['docx', 'xlsx', 'pptx']);
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const WEBVTT = [...Buffer.from('WEBVTT')];
// A renamed file would make Read fail or misread it, so binary types must start with their signature.
// Office files are zip containers; a transcript may start with a byte-order mark.
const SIGNATURES = {
  png: [[0x89, 0x50, 0x4e, 0x47]], jpg: [[0xff, 0xd8, 0xff]], jpeg: [[0xff, 0xd8, 0xff]], gif: [[0x47, 0x49, 0x46, 0x38]],
  webp: [[0x52, 0x49, 0x46, 0x46]], pdf: [[0x25, 0x50, 0x44, 0x46]],
  docx: [ZIP], xlsx: [ZIP], pptx: [ZIP], vtt: [WEBVTT, [0xef, 0xbb, 0xbf, ...WEBVTT]],
};
export const MAX_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_TOTAL = 25 * 1024 * 1024;
/** JSON body limit for a message with files: base64 grows them by a third, plus the JSON around them. */
export const ATTACHMENT_REQUEST_BYTES = Math.ceil(MAX_ATTACHMENTS_TOTAL * 1.4) + 64 * 1024;
const MB = 1024 * 1024;
const extension = name => path.extname(name).slice(1).toLowerCase();

/**
 * Decode and check a message's files (FR-3, FR-4). No files gives an empty list. The route reads up to
 * ATTACHMENT_REQUEST_BYTES; everything but the files still keeps the normal request limit.
 */
export function decodeAttachments(files, rest = {}) {
  if (Buffer.byteLength(JSON.stringify(rest)) > config.maxRequestBytes) throw httpError(413, `Request body exceeds ${config.maxRequestBytes} byte limit`);
  if (files === undefined || files === null) return [];
  if (!Array.isArray(files)) throw httpError(400, 'attachments must be a list of files');
  if (files.length > MAX_ATTACHMENTS) throw httpError(400, `Attach at most ${MAX_ATTACHMENTS} files to a message`);
  const out = []; const names = new Set(); let total = 0;
  for (const file of files) {
    const original = String(file?.name || 'file');
    let name = safeDocumentName(original);
    const ext = extension(name);
    if (!name || !TYPES[ext]) throw httpError(400, `${original} is not a file Sonic can read. Attach an image, a PDF, a Word, Excel or PowerPoint file, a meeting transcript (.vtt) or a text file (CSV, JSON, YAML, SQL, markdown, log)`);
    const data = Buffer.from(String(file?.data || '').replace(/^data:[^;]*;base64,/, ''), 'base64');
    if (!data.length) throw httpError(400, `${name} is empty`);
    if (data.length > MAX_ATTACHMENT_BYTES) throw httpError(400, `${name} is larger than ${MAX_ATTACHMENT_BYTES / MB} MB`);
    if (SIGNATURES[ext] && !SIGNATURES[ext].some(sig => sig.every((byte, index) => data[index] === byte))) throw httpError(400, `${name} is not a real .${ext} file`);
    total += data.length;
    if (total > MAX_ATTACHMENTS_TOTAL) throw httpError(400, `The files are larger than ${MAX_ATTACHMENTS_TOTAL / MB} MB together; send them in more than one message`);
    // Two files with one name in a message both keep: the later ones are numbered.
    const stem = name.slice(0, name.length - ext.length - 1);
    for (let n = 2; names.has(name.toLowerCase()); n += 1) name = `${stem} (${n}).${ext}`;
    names.add(name.toLowerCase());
    out.push({ name, data, mime: TYPES[ext] });
  }
  return out;
}

/** Save decoded files under <task folder>/attachments/<message id>/ (FR-6) and return what the events store. */
export async function saveAttachments(taskDir, messageId, files) {
  if (!files.length) return [];
  const key = String(messageId).replace(/[^A-Za-z0-9._-]+/g, '-');
  const dir = safeJoin(taskDir, path.join('attachments', key));
  await fs.mkdir(dir, { recursive: true });
  const saved = [];
  for (const file of files) {
    const target = safeJoin(dir, file.name);
    await fs.writeFile(target, file.data);
    saved.push({ name: file.name, path: path.relative(taskDir, target).replaceAll('\\', '/'), size: file.data.length, mime: file.mime });
  }
  return saved;
}

/** The text a message with files and no words gets (FR-5). */
export const attachmentOnlyText = count => `Take a look at the attached ${count === 1 ? 'file' : 'files'}.`;

/** What the agent is told about a message's files (FR-7); `relativeTaskDir` is the task folder seen from the workspace. */
export function attachmentLines(attachments, relativeTaskDir) {
  const list = Array.isArray(attachments) ? attachments.filter(item => item?.path) : [];
  if (!list.length) return '';
  const size = bytes => bytes >= MB ? `${(bytes / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const lines = list.map(item => `- ${relativeTaskDir}/${item.path} (${item.mime || 'file'}, ${size(Number(item.size) || 0)})`);
  // Read cannot open Office files (SPEC-knowledge-03 FR-5), so say once how to get their text.
  const office = list.some(item => OFFICE.has(extension(String(item.name || item.path))));
  const officeLine = office ? '\nRead cannot open Word, Excel or PowerPoint files. Get their text with the knowledge-extract skill\'s scripts/extract_docs.py (scan the attachment folder, then chunks). Read a large spreadsheet, such as a ticket export, with Python and openpyxl so no rows are cut.' : '';
  // SPEC-tasks-12 FR-10: numbers read off a picture are often wrong, so a screenshot only says where to look.
  const image = list.some(item => /^image\//.test(String(item.mime || '')) || /\.(png|jpe?g|gif|webp)$/i.test(String(item.name || item.path)));
  const imageLine = image ? '\nTreat an image as a pointer, not as evidence: work out which page, board, widget, table or job it shows from the screen context and the titles in it, then read the real data with your tools and answer from that. If you cannot match it to data you can read, say so. Call any number you could only read from the image unconfirmed.' : '';
  return `<attachments>\nThe person attached ${list.length === 1 ? 'this file' : 'these files'} to the message. Open ${list.length === 1 ? 'it' : 'each one'} with Read before you answer; Read shows images and PDFs to you directly.${officeLine}${imageLine}\n${lines.join('\n')}\n</attachments>\n\n`;
}

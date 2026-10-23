import fs from 'node:fs/promises';
import path from 'node:path';
import AdmZipModule from 'adm-zip';
import { ensureDir, exists, safeJoin } from '../lib/fs.mjs';
import { slug, httpError } from '../lib/util.mjs';

// Skills: the plugin's 14 (read-only) plus custom ones uploaded as a zip into the workspace's
// .claude/skills/<name>. Claude Code picks custom skills up from the workspace on the next
// session, so uploading is all it takes.

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_ZIP_BYTES = 25 * 1024 * 1024;
type ListedSkill = {id:string;name:string;description:string;origin:string;dir:string;shared?:boolean};
type SkillSummary = Omit<ListedSkill,'dir'> & {heading:string};
type SkillUploadResult = Partial<SkillSummary> & {files:number;replaced:boolean;uploadedBy:string|null};
type SkillWorkspace = {listSkills():Promise<ListedSkill[]>;skillDir(id:string):string;tree(dir:string):Promise<unknown>;readFile(dir:string,relative:string):Promise<unknown>;isGrantLink(kind:string,name:string):Promise<boolean>;linkLibraryEntry(kind:string,name:string):Promise<unknown>};
type SkillLibrary = {skillPath(name:string):string};
type SkillUser = {id?:string|null};
type SkillOptions = {workspace:SkillWorkspace;library?:SkillLibrary|null;onShared?:(input:{name:string})=>unknown|Promise<unknown>;onUnshare?:(input:{name:string})=>unknown|Promise<unknown>};
type SkillUpload = {zipBase64?:string;name?:string;user?:SkillUser}|undefined;
type ZipEntry = {isDirectory:boolean;entryName:string;getData():Buffer};
type ZipArchive = {getEntries():ZipEntry[]};
const AdmZip = AdmZipModule as unknown as new (buffer:Buffer)=>ZipArchive;
const frontmatterName = (text:string):string|null => { const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text); if (!match) return null; const line = match[1].split(/\r?\n/).find(item => /^name\s*:/.test(item)); return line ? line.replace(/^name\s*:\s*/, '').trim().replace(/^['"]|['"]$/g, '') : null; };

const firstHeading = async (file:string):Promise<string> => { try { const text = (await fs.readFile(file, 'utf8')).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, ''); const match = /^#\s+(.+?)\s*#*\s*$/m.exec(text); return match ? match[1].trim() : ''; } catch { return ''; } };

// An instance serves ONE project. Uploaded skills are added to the shared library (an admin adds, then grants) and show up
// in the project as a link at .claude/skills/<name>; they are read-only there. Without a library (a single fixed workspace,
// as a test builds one) a skill is simply a folder of the project (SPEC-projects-01 FR-31, FR-34).
export class SkillService {
  workspace:SkillWorkspace;
  library:SkillLibrary|null;
  onShared:(input:{name:string})=>unknown|Promise<unknown>;
  onUnshare:(input:{name:string})=>unknown|Promise<unknown>;
  constructor({ workspace, library = null, onShared = async () => {}, onUnshare = async () => {} }:SkillOptions) { Object.assign(this, { workspace, library, onShared, onUnshare }); this.workspace=workspace; this.library=library; this.onShared=onShared; this.onUnshare=onUnshare; }

  /** Every skill with its SKILL.md frontmatter and the first heading of its body (a short plain-words title, e.g. "Investigate root cause"). */
  async list():Promise<SkillSummary[]> {
    const skills = await this.workspace.listSkills();
    return Promise.all(skills.map(async ({ dir, ...skill }) => ({ ...skill, heading: await firstHeading(path.join(dir, 'SKILL.md')) })));
  }
  async tree(id:string):Promise<unknown> { return this.workspace.tree(this.workspace.skillDir(id)); }
  async file(id:string, relative:string):Promise<unknown> { if (!relative) throw httpError(400, 'path is required'); return this.workspace.readFile(this.workspace.skillDir(id), relative); }

  /** Install a zipped skill folder. The zip must contain one SKILL.md; the folder around it becomes the skill. */
  async upload({ zipBase64, name, user }:SkillUpload = {}):Promise<SkillUploadResult> {
    if (!zipBase64 || typeof zipBase64 !== 'string') throw httpError(400, 'zipBase64 is required');
    const buffer = Buffer.from(zipBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');
    if (!buffer.length) throw httpError(400, 'The zip file is empty');
    if (buffer.length > MAX_ZIP_BYTES) throw httpError(400, 'The zip file is larger than 25 MB');
    let zip; try { zip = new AdmZip(buffer); } catch { throw httpError(400, 'The file is not a valid zip archive'); }
    const entries = zip.getEntries().filter(entry => !entry.isDirectory && !/(^|\/)(__MACOSX|\.DS_Store)/.test(entry.entryName));
    for (const entry of entries) { const parts = entry.entryName.split(/[\\/]/); if (path.isAbsolute(entry.entryName) || parts.includes('..')) throw httpError(400, `Unsafe path in zip: ${entry.entryName}`); }
    const skillFiles = entries.filter(entry => /(^|\/)SKILL\.md$/.test(entry.entryName)).sort((a, b) => a.entryName.split('/').length - b.entryName.split('/').length);
    if (!skillFiles.length) throw httpError(400, 'The zip has no SKILL.md');
    const root = skillFiles[0].entryName.replace(/SKILL\.md$/, '');
    const skillText = skillFiles[0].getData().toString('utf8');
    const key = slug(name || frontmatterName(skillText) || root.replace(/\/$/, '').split('/').pop());
    if (!SLUG.test(key)) throw httpError(400, 'The skill needs a name in SKILL.md frontmatter (letters, numbers, dashes)');
    // A skill of the same name that is a plain folder of the project is not replaced by a shared one.
    if (this.library) { const own = this.workspace.skillDir(`custom:${key}`); if (await fs.lstat(own).then(() => true, () => false) && !(await this.workspace.isGrantLink('skills', key))) throw httpError(409, `This project already has its own skill named ${key}`); }
    const target = this.library ? this.library.skillPath(key) : this.workspace.skillDir(`custom:${key}`);
    const replaced = await exists(target);
    if (replaced) await fs.rm(target, { recursive: true, force: true });
    await ensureDir(target);
    let written = 0;
    for (const entry of entries) {
      if (!entry.entryName.startsWith(root)) continue;
      const relative = entry.entryName.slice(root.length); if (!relative) continue;
      const file = safeJoin(target, relative); // throws when a zip entry tries to escape the skill folder
      await ensureDir(path.dirname(file));
      await fs.writeFile(file, entry.getData());
      written += 1;
    }
    if (this.library) { await this.workspace.linkLibraryEntry('skills', key); await this.onShared({ name: key }); }
    const skill = (await this.list()).find(item => item.id === `custom:${key}`);
    return { ...skill, files: written, replaced, uploadedBy: user?.id || null };
  }

  async remove(id:string):Promise<boolean> {
    if (!String(id).startsWith('custom:')) throw httpError(400, 'Only custom skills can be removed');
    const dir = this.workspace.skillDir(id);
    const name = String(id).slice('custom:'.length);
    const existed = await fs.lstat(dir).then(() => true, () => false);
    // A shared skill is deleted from the library (its link here goes with it); a grant held by another project blocks it (FR-34).
    if (this.library && await this.workspace.isGrantLink('skills', name)) { await this.onUnshare({ name }); await fs.rm(dir, { recursive: true, force: true }); await fs.rm(this.library.skillPath(name), { recursive: true, force: true }); return existed; }
    await fs.rm(dir, { recursive: true, force: true });
    return existed;
  }
}

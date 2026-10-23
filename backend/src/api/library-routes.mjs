import { reply, route, scoped } from '../lib/router.mjs';
import { UPLOAD_REQUEST_BYTES } from '../knowledge/knowledge-service.mjs';
import { forProject } from '../projects/project-bound.mjs';
import { passState, setPass } from '../knowledge/knowledge-pass.mjs';

// Skills, Knowledge and Templates: read-only browsers for everyone, uploads and Git syncs for
// admins (see rbac ADMIN_ROUTES). What a project sees is its own folder plus the shared bases and skills granted to it
// (FR-31); an upload or a Git add goes to the shared library and is granted to the request's project.
export function libraryRoutes({ skills, knowledge, templates, routines = null }) {
  const draftAction = kind => async ({ params: { name }, body, user, scope }) => {
    const b = await body();
    if (!b.all && !b.path) return reply(400, { error: 'Give the draft path, or all: true' });
    const target = b.all ? null : String(b.path);
    const bases = await forProject(knowledge, scope);
    return kind === 'keep' ? bases.keepDrafts(name, target, user) : bases.discardDrafts(name, target);
  };
  const templatesOf = scope => forProject(templates, scope);
  const skillsOf = scope => forProject(skills, scope);
  const knowledgeOf = scope => forProject(knowledge, scope);
  const passOf = async scope => ({ routines: routines ? await forProject(routines, scope) : null, journeys: (await knowledgeOf(scope)).journeys });
  return scoped('project', [
    ...(templates ? [
      route('GET', '/api/templates', async ({ scope }) => ({ presets: (await templatesOf(scope)).presets() })),
      route('POST', '/api/templates/upload', async ({ body, user, scope }) => reply(201, await (await templatesOf(scope)).upload({ ...await body(), user })), 'project.settings'),
    ] : []),
    ...(skills ? [
      route('GET', '/api/skills', async ({ scope }) => ({ items: await (await skillsOf(scope)).list() })),
      route('POST', '/api/skills/upload', async ({ body, user, scope }) => reply(201, await (await skillsOf(scope)).upload({ ...await body(), user })), 'skills.manage'),
      route('GET', '/api/skills/:id/tree', async ({ params: { id }, scope }) => ({ id, items: await (await skillsOf(scope)).tree(id) })),
      route('GET', '/api/skills/:id/file', async ({ params: { id }, url, scope }) => (await skillsOf(scope)).file(id, url.searchParams.get('path'))),
      route('DELETE', '/api/skills/:id', async ({ params: { id }, scope }) => ({ id, deleted: await (await skillsOf(scope)).remove(id) }), 'skills.manage'),
    ] : []),
    ...(knowledge ? [
      route('GET', '/api/knowledge', async ({ scope }) => (await knowledgeOf(scope)).list()),
      route('POST', '/api/knowledge', async ({ body, user, scope }) => reply(201, await (await knowledgeOf(scope)).add({ ...await body(), user })), 'knowledge.manage'),
      // Look inside a repository before adding it: the folder tree, nothing kept on disk.
      // Knowledge setup (SPEC-knowledge-03): the owner's one task that interviews the team and drafts the project's knowledge.
      route('GET', '/api/knowledge/setup', async ({ scope }) => (await knowledgeOf(scope)).setupTask()),
      route('POST', '/api/knowledge/setup', async ({ body, user, scope }) => { const result = await (await knowledgeOf(scope)).setup({ base: (await body()).base, user }); return reply(result.created ? 201 : 200, result); }, 'knowledge.review'),
      // Eval scores per journey (SPEC-knowledge-06 FR-5) and the weekly pass (SPEC-knowledge-07 FR-1, FR-2); literal paths before :name.
      route('GET', '/api/knowledge/journeys', async ({ scope }) => (await knowledgeOf(scope)).journeyList()),
      route('GET', '/api/knowledge/pass', async ({ scope }) => passState(await passOf(scope))),
      route('PUT', '/api/knowledge/pass', async ({ body, user, scope }) => setPass(await passOf(scope), await body(), user), 'knowledge.review'),
      route('POST', '/api/knowledge/inspect', async ({ body, scope }) => (await knowledgeOf(scope)).inspect(await body()), 'knowledge.manage'),
      // A base built from uploaded documents; a task extracts draft pages from them.
      route('POST', '/api/knowledge/upload', async ({ body, user, scope }) => reply(201, await (await knowledgeOf(scope)).upload({ ...await body(UPLOAD_REQUEST_BYTES), user })), 'knowledge.manage'),
      route('POST', '/api/knowledge/:name/documents', async ({ params: { name }, body, user, scope }) => reply(201, await (await knowledgeOf(scope)).addDocuments(name, { ...await body(UPLOAD_REQUEST_BYTES), user })), 'knowledge.manage'),
      route('POST', '/api/knowledge/:name/sync', async ({ params: { name }, scope }) => (await knowledgeOf(scope)).sync(name), 'knowledge.manage'),
      // How kept drafts reach a Git base: a pull request for its reviewers (default) or straight to the branch.
      route('PUT', '/api/knowledge/:name', async ({ params: { name }, body, scope }) => (await knowledgeOf(scope)).setReview(name, String((await body()).review || '')), 'knowledge.manage'),
      route('GET', '/api/knowledge/:name/map', async ({ params: { name }, scope }) => (await knowledgeOf(scope)).map(name)),
      route('GET', '/api/knowledge/:name/tree', async ({ params: { name }, scope }) => ({ name, items: await (await knowledgeOf(scope)).tree(name) })),
      // The agent's drafts: everyone can read them; keeping or discarding is an admin POST (rbac ADMIN_ROUTES).
      route('GET', '/api/knowledge/:name/drafts', async ({ params: { name }, scope }) => ({ name, items: await (await knowledgeOf(scope)).listDrafts(name) })),
      route('POST', '/api/knowledge/:name/drafts/keep', draftAction('keep'), 'knowledge.review'),
      route('POST', '/api/knowledge/:name/drafts/discard', draftAction('discard'), 'knowledge.review'),
      route('GET', '/api/knowledge/:name/file', async ({ params: { name }, url, scope }) => (await knowledgeOf(scope)).file(name, url.searchParams.get('path'))),
      route('DELETE', '/api/knowledge/:name', async ({ params: { name }, scope }) => ({ name, deleted: await (await knowledgeOf(scope)).remove(name) }), 'knowledge.manage'),
    ] : []),
  ]);
}

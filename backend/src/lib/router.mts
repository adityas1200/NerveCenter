import type { IncomingMessage, ServerResponse } from 'node:http';
import { readBody, sendJson } from './http.mjs';

export type Permission =
  | 'admin' | 'tickets.manage' | 'tasks.manage' | 'approvals.decide' | 'routines.manage' | 'boards.manage'
  | 'skills.manage' | 'knowledge.manage' | 'connectors.use' | 'project.settings' | 'project.members'
  | 'project.grants' | 'knowledge.review' | 'users.manage' | 'roles.manage' | 'security.manage'
  | 'audit.view' | 'secrets.manage' | 'connections.manage' | 'settings.platform.manage' | 'logs.view'
  | 'projects.create';
export type ScopeClass = 'project' | 'project-read' | 'global' | 'admin-global';
export type RouteMethod = string;

export interface ProjectScope {
  projectId: string;
  projectIds: readonly string[];
  all: boolean;
  admin: boolean;
  archived: boolean;
  system?: boolean;
  projectRole?: string;
  access?: string;
  memberProjectIds?: readonly string[];
}

export interface RouteUser {
  id: string;
  name: string;
  groups: string[];
  roles: string[];
  role?: string;
  appRole?: string;
  projectRole?: string;
  permissions?: string[];
  [key: string]: unknown;
}

export interface RouteContext {
  m: string;
  p: string[];
  req: IncomingMessage;
  res: ServerResponse;
  user: RouteUser;
  url: URL;
  [key: string]: unknown;
}

export interface HandlerContext extends RouteContext {
  params: Record<string, string>;
  scope: ProjectScope | null | undefined;
  body(maximum?: number): Promise<unknown>;
}

export type HandlerResult = unknown | Reply | typeof NEXT | undefined;
export type RouteHandler = (context: HandlerContext) => HandlerResult | Promise<HandlerResult>;

export interface RouteEntry {
  methods: string[] | null;
  parts: string[];
  handler: RouteHandler;
  needs?: Permission | '*';
  pattern: string;
  scope?: ScopeClass;
  linkable?: boolean;
}

export const NEXT: unique symbol = Symbol('next');
export class Reply {
  constructor(public readonly status: number, public readonly body: unknown) {}
}
export const reply = (status: number, body: unknown): Reply => new Reply(status, body);
export const route = (method: RouteMethod, pattern: string, handler: RouteHandler, needs?: Permission | '*'): RouteEntry => ({
  methods: method === '*' ? null : method.split('|'),
  parts: pattern.split('/').filter(Boolean),
  handler,
  needs,
  pattern,
});

/** Give every route in `routes` its scope class. */
export const scoped = <T extends RouteEntry>(scope: ScopeClass, routes: readonly T[]): T[] => routes.map(entry => ({ ...entry, scope }));
/** SPEC-projects-01 FR-50: browser-opened GETs can name the project in the query. */
export const linkable = <T extends RouteEntry>(entry: T): T & { linkable: true } => {
  if (entry.methods?.join() !== 'GET') throw new Error(`Only a GET route can be linkable: ${entry.pattern}`);
  return { ...entry, linkable: true };
};

export function assertRouteTable(routes: readonly RouteEntry[], classes: readonly ScopeClass[]): void {
  for (const entry of routes) {
    const methods = entry.methods || ['*'];
    if (entry.scope === undefined || !classes.includes(entry.scope)) {
      throw new Error(`Route ${methods.join('|')} ${entry.pattern} does not declare a scope class`);
    }
    if (entry.needs === undefined && methods.some(method => method === '*' || ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase()))) {
      throw new Error(`Route ${methods.join('|')} ${entry.pattern} does not declare a permission`);
    }
  }
}

function match({ methods, parts }: Pick<RouteEntry, 'methods' | 'parts'>, method: string, path: string[]): Array<[string, number]> | null {
  if (methods && !methods.includes(method)) return null;
  const rest = parts[parts.length - 1] === '*';
  const fixed = rest ? parts.length - 1 : parts.length;
  if (rest ? path.length < fixed : path.length !== fixed) return null;
  const found: Array<[string, number]> = [];
  for (let i = 0; i < fixed; i += 1) {
    const part = parts[i];
    if (part[0] === ':' || part[0] === '$') found.push([part.slice(1), part[0] === ':' ? i : -i - 1]);
    else if (part !== path[i]) return null;
  }
  return found;
}

/** Runs the first matching route. Resolves true when one handled the request. */
export async function dispatch(
  routes: readonly RouteEntry[],
  ctx: RouteContext & {
    resolveScope?: (entry: RouteEntry) => ProjectScope | null | undefined | Promise<ProjectScope | null | undefined>;
    scopeUser?: (scope: ProjectScope | null | undefined) => RouteUser;
    authorize?: (needs: Permission | '*' | undefined, method: string, user: RouteUser, scope: ProjectScope | null | undefined) => void;
  },
): Promise<boolean> {
  for (const entry of routes) {
    const found = match(entry, ctx.m, ctx.p);
    if (!found) continue;
    const scope = ctx.resolveScope ? await ctx.resolveScope(entry) : undefined;
    const user = ctx.scopeUser ? ctx.scopeUser(scope) : ctx.user;
    ctx.authorize?.(entry.needs, ctx.m, user, scope);
    const params = Object.fromEntries(found.map(([name, at]) => [name, at >= 0 ? decodeURIComponent(ctx.p[at]) : ctx.p[-at - 1]]));
    const result = await entry.handler({ ...ctx, user, params, scope, body: async maximum => (await readBody(ctx.req, maximum)) || {} });
    if (result === NEXT) continue;
    if (result !== undefined) sendJson(ctx.res, result instanceof Reply ? result.status : 200, result instanceof Reply ? result.body : result);
    return true;
  }
  return false;
}

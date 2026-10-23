import type { IncomingMessage, ServerResponse } from 'node:http';
import { config } from '../config.mjs';
import { httpError } from './util.mjs';

export interface HttpError extends Error {
  projectId?: string;
}

export async function readBody(req: IncomingMessage, maximum = config.maxRequestBytes): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maximum) throw httpError(413, `Request body exceeds ${maximum} byte limit`);
    chunks.push(buffer);
  }
  if (!chunks.length) return undefined;
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return undefined;
  try { return JSON.parse(raw) as unknown; }
  catch (error) { if (error instanceof SyntaxError) throw httpError(400, 'Request body must be valid JSON.'); throw error; }
}

export function errorCode(status: number): string {
  if (status >= 500) return 'INTERNAL_ERROR';
  return ({ 400: 'INVALID_REQUEST', 401: 'UNAUTHENTICATED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 405: 'METHOD_NOT_ALLOWED', 409: 'CONFLICT', 413: 'PAYLOAD_TOO_LARGE', 429: 'RATE_LIMITED' } as Record<number,string>)[status] || 'REQUEST_FAILED';
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const record = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string,unknown> : null;
  const responseBody = status >= 400 && typeof record?.error === 'string'
    ? { ...record, error: status >= 500 ? 'The request could not be completed.' : record.error, code: typeof record.code === 'string' ? record.code : errorCode(status) }
    : body;
  const payload = JSON.stringify(responseBody, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'access-control-allow-origin': config.corsOrigin,
    'access-control-allow-headers': config.identityMode === 'development' ? 'content-type,authorization,x-nervecenter-project,x-user-id,x-user-name,x-user-groups,x-user-roles' : 'content-type,authorization,x-nervecenter-project',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  });
  res.end(payload);
}

export function sendError(res: ServerResponse, status: number, error: unknown): void {
  const candidate = error as { projectId?: unknown } | null;
  sendJson(res, status, {
    error: status >= 500 ? 'The request could not be completed.' : error instanceof Error ? error.message : String(error),
    ...(candidate?.projectId ? { projectId: candidate.projectId } : {}),
  });
}

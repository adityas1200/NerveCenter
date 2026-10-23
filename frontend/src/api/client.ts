import { PROJECT_HEADER, getCurrentProject, notifyOtherProject } from "@/api/projects";
import { cookieAuthEnabled } from "@/auth-session";
import { canRecoverCookieSession, expireCookieSession, revalidateCookieSession, sessionExpired } from "@/api/session";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface RequestOptions extends Omit<RequestInit, "body" | "method"> {
  body?: unknown;
}

export interface SseMessage<T> {
  data: T;
  event?: string;
  id?: string;
  retry?: number;
}

export interface SseOptions<T> {
  signal?: AbortSignal;
  onMessage: (message: SseMessage<T>) => void;
  onOpen?: (response: Response) => void;
}

const baseUrl = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
/** Prefix for URLs handed straight to the browser (images, iframes, downloads). */
export const apiBaseUrl = baseUrl;

function requestHeaders(init?: HeadersInit, accept = "application/json"): Headers {
  const next = new Headers(init);
  if (!next.has("accept")) next.set("accept", accept);
  const project = getCurrentProject();
  if (project && !next.has(PROJECT_HEADER)) next.set(PROJECT_HEADER, project);
  if (import.meta.env.DEV) {
    const id = import.meta.env.VITE_DEV_USER_ID;
    const name = import.meta.env.VITE_DEV_USER_NAME;
    const roles = import.meta.env.VITE_DEV_USER_ROLES;
    if (id) next.set("x-user-id", id);
    if (name) next.set("x-user-name", name);
    if (roles) next.set("x-user-roles", roles);
  }
  return next;
}

async function responseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json().catch(() => undefined);
  }
  return response.text().catch(() => undefined);
}

function errorFields(body: unknown, fallback: string): { message: string; code?: string } {
  if (typeof body === "string" && body.trim()) return { message: body };
  if (body && typeof body === "object") {
    const value = body as { error?: unknown; message?: unknown; code?: unknown };
    const message = value.error ?? value.message;
    return {
      message: typeof message === "string" && message ? message : fallback,
      code: typeof value.code === "string" ? value.code : undefined,
    };
  }
  return { message: fallback };
}

// Proxies in front of the backend answer these with an HTML page, which is no use as a message.
const PROXY_MESSAGES: Record<number, string> = {
  413: "This is too large to send. Attach smaller files, or fewer at once.",
  502: "NerveCenter is not reachable right now. Try again in a minute.",
  503: "NerveCenter is not reachable right now. Try again in a minute.",
  504: "NerveCenter took too long to answer. Try again in a minute.",
};

async function assertOk(response: Response): Promise<Response> {
  if (response.ok) return response;
  const html = (response.headers.get("content-type") || "").includes("text/html");
  const body = html ? undefined : await responseBody(response);
  const fallback = PROXY_MESSAGES[response.status] || response.statusText || `Request failed (${response.status})`;
  const { message, code } = errorFields(body, fallback);
  const otherProject = (body as { projectId?: unknown } | undefined)?.projectId;
  if (response.status === 403 && typeof otherProject === "string") notifyOtherProject(otherProject);
  throw new ApiError(message, response.status, body, code);
}

async function fetchResponse(path: string, init: RequestInit): Promise<Response> {
  try {
    if (path !== "/api/meta" && cookieAuthEnabled() && sessionExpired()) throw new ApiError("Your session has expired. Please sign in again.", 401, undefined, "SESSION_EXPIRED");
    const response = await fetch(`${baseUrl}${path}`, init);
    if (path === "/api/meta" || response.status !== 401 || !canRecoverCookieSession()) return response;
    // FR-2/FR-5: replay only a rejected 401, never a network failure or a 403.
    if (!await revalidateCookieSession(init.signal)) return response;
    init.signal?.throwIfAborted();
    if (sessionExpired()) return response;
    const retried = await fetch(`${baseUrl}${path}`, init);
    if (retried.status === 401) expireCookieSession();
    return retried;
  } catch (error) {
    if (init.signal?.aborted) throw init.signal.reason;
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      error instanceof Error ? error.message : "Network request failed",
      0,
      error,
      "NETWORK_ERROR",
    );
  }
}

async function request<T>(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<T> {
  const { body, headers: initialHeaders, ...init } = options;
  const headers = requestHeaders(initialHeaders);
  if (body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetchResponse(path, {
    ...init,
    method,
    headers,
    credentials: "include",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  await assertOk(response);
  return responseBody(response) as Promise<T>;
}

export const apiClient = {
  get: <T>(path: string, options?: Omit<RequestOptions, "body">) => request<T>("GET", path, options),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "body">) =>
    request<T>("POST", path, { ...options, body }),
  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "body">) =>
    request<T>("PUT", path, { ...options, body }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "body">) =>
    request<T>("PATCH", path, { ...options, body }),
  delete: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "body">) =>
    request<T>("DELETE", path, { ...options, body }),
};

function parseSseFrame<T>(frame: string): SseMessage<T> | null {
  let event: string | undefined;
  let id: string | undefined;
  let retry: number | undefined;
  const data: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue;
    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    const value = separator === -1 ? "" : line.slice(separator + 1).replace(/^ /, "");
    if (field === "data") data.push(value);
    if (field === "event") event = value;
    if (field === "id") id = value;
    if (field === "retry") retry = Number(value);
  }
  if (!data.length) return null;
  const raw = data.join("\n");
  let parsed: T;
  try {
    parsed = JSON.parse(raw) as T;
  } catch {
    parsed = raw as T;
  }
  return { data: parsed, event, id, retry };
}

export async function streamSse<T>(path: string, options: SseOptions<T>): Promise<void> {
  const response = await fetchResponse(path, {
    method: "GET",
    signal: options.signal,
    headers: requestHeaders(undefined, "text/event-stream"),
    credentials: "include",
  });
  await assertOk(response);
  if (!response.body) throw new ApiError("Event stream response had no body", response.status);
  options.onOpen?.(response);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const message = parseSseFrame<T>(frame);
      if (message) options.onMessage(message);
    }
    if (done) break;
  }
  const finalMessage = parseSseFrame<T>(buffer);
  if (finalMessage) options.onMessage(finalMessage);
}

export function fileUrl(ticketId: string, fileId: string): string {
  return `${baseUrl}/api/workbench/${encodeURIComponent(ticketId)}/files/${encodeURIComponent(fileId)}`;
}

import { manualQueryDefaults } from "@/api/queryPolicy";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { vi } from "vitest";

/** A JSON `Response` wrapped in a promise, the shape every stubbed `fetch` returns. */
export function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

/** The `/api/me` payloads the tests use. Pass the result of `meResponse` from a `mockFetch` handler. */
export const testUsers = {
  admin: { id: "admin.local", name: "Admin" },
  demo: { id: "demo.user", name: "Demo User" },
  dev: { id: "dev", name: "Dev" },
  operator: { id: "mitesh", name: "Mitesh" },
} as const;

export function meResponse(user: { id: string; name: string }, role: string, permissions: string[] = []): Promise<Response> {
  return jsonResponse({ user, role, permissions });
}

/** A query client that never retries, so a failing request surfaces on the first attempt. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { ...manualQueryDefaults }, mutations: { retry: false } } });
}

/** Renders `ui` inside a `QueryClientProvider`. Put routers, toasts and other providers inside `ui`. */
export function renderWithClient(ui: ReactElement, options?: Omit<RenderOptions, "wrapper">): RenderResult & { client: QueryClient } {
  const client = createTestQueryClient();
  return { ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>, options), client };
}

export type FetchHandler = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Stubs global `fetch` with `handler`, called with the request URL as a string and the init.
 * The returned mock records every call; setup.ts restores the real `fetch` after each test.
 */
export function mockFetch(handler: FetchHandler) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** An open `text/event-stream` response carrying the given raw frames (none by default). */
export function sseResponse(frames: string[] = []): Promise<Response> {
  return Promise.resolve(new Response(frames.join(""), { status: 200, headers: { "content-type": "text/event-stream" } }));
}

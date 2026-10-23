import { streamSse, type SseMessage } from "@/api/client";

export interface ProjectChangeHint {
  projectId: string;
  resource: string;
  id?: string;
  at: string;
}

export interface ChangeStreamHandlers {
  onMessage: (message: SseMessage<unknown>) => void;
}

/** SPEC-platform-13 FR-4: project scope is carried by the shared API client's project header. */
export const changesApi = {
  stream: (handlers: ChangeStreamHandlers, signal?: AbortSignal) =>
    streamSse<unknown>("/api/changes/stream", { ...handlers, signal }),
};

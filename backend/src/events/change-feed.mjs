// Process-local change hints. The event contains identifiers only; consumers refetch authoritative data.
export class ChangeFeed {
  #projects = new Map();

  publish({ resource, id, projectId }) {
    if (resource !== 'ticket' || typeof projectId !== 'string' || !projectId) return;
    const hint = Object.freeze({ resource, ...(typeof id === 'string' && id ? { id } : {}), projectId, at: new Date().toISOString() });
    const subscribers = this.#projects.get(projectId);
    for (const subscriber of subscribers || []) {
      try { subscriber(hint); }
      catch {
        // A broken response must not turn an already persisted ticket write into an API failure.
        subscribers.delete(subscriber);
        if (!subscribers.size) this.#projects.delete(projectId);
      }
    }
  }

  subscribe(projectId, listener) {
    let subscribers = this.#projects.get(projectId);
    if (!subscribers) this.#projects.set(projectId, subscribers = new Set());
    subscribers.add(listener);
    let closed = false;
    return () => {
      if (closed) return;
      closed = true;
      subscribers.delete(listener);
      if (!subscribers.size) this.#projects.delete(projectId);
    };
  }

  subscriberCount(projectId) { return this.#projects.get(projectId)?.size || 0; }
}

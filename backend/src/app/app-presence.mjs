const DEFAULT_IDLE_SECONDS = Number(process.env.OPS_SYNC_IDLE_SECONDS || 90);

/** Tracks whether at least one browser has used the authenticated app recently. */
export class AppPresence {
  constructor({ idleSeconds = DEFAULT_IDLE_SECONDS, clock = () => Date.now() } = {}) {
    this.idleSeconds = Number(idleSeconds);
    this.clock = clock;
    this.lastActiveAt = 0;
  }

  touch() {
    this.lastActiveAt = this.clock();
    return this.status();
  }

  isActive() {
    if (!(this.idleSeconds > 0)) return true;
    return this.lastActiveAt > 0 && this.clock() - this.lastActiveAt <= this.idleSeconds * 1000;
  }

  status() {
    return {
      active: this.isActive(),
      idleSeconds: this.idleSeconds,
      lastActiveAt: this.lastActiveAt ? new Date(this.lastActiveAt).toISOString() : null,
    };
  }
}

// In-memory fixed-window counter. Enough for a single API process; move to the database
// or Redis if the API runs on several processes.
// The options object is read on every call, so changes to `config` apply immediately.
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly options: { max: number; windowMs: number }) {}

  isLimited(key: string): boolean {
    const entry = this.hits.get(key);
    return entry !== undefined && entry.resetAt > Date.now() && entry.count >= this.options.max;
  }

  record(key: string): void {
    const now = Date.now();
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.prune(now);
      this.hits.set(key, { count: 1, resetAt: now + this.options.windowMs });
    } else {
      entry.count++;
    }
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  private prune(now: number) {
    if (this.hits.size < 10000) return;
    for (const [key, entry] of this.hits) {
      if (entry.resetAt <= now) this.hits.delete(key);
    }
  }
}

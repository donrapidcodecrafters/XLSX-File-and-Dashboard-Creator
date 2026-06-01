export class ExecutionCache<T> {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly cache = new Map<string, { expiresAt: number; value: Promise<T> }>();

  constructor(ttlMs: number, maxEntries = 500) {
    this.ttlMs = ttlMs;
    this.maxEntries = Math.max(1, maxEntries);
  }

  private prune(now: number) {
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt <= now) {
        this.cache.delete(key);
      }
    }
    while (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (!oldestKey) break;
      this.cache.delete(oldestKey);
    }
  }

  getOrCreate(key: string, factory: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }
    this.prune(now);
    const value = factory();
    this.cache.set(key, { expiresAt: now + this.ttlMs, value });
    value.catch(() => {
      this.cache.delete(key);
    });
    return value;
  }

  /** Remove all entries whose key contains any of the provided substrings. */
  invalidateMatching(...substrings: string[]) {
    for (const key of this.cache.keys()) {
      if (substrings.some((s) => key.includes(s))) {
        this.cache.delete(key);
      }
    }
  }

  /** Remove all entries. */
  clear() {
    this.cache.clear();
  }
}

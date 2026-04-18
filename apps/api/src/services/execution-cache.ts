export class ExecutionCache<T> {
  private readonly ttlMs: number;
  private readonly cache = new Map<string, { expiresAt: number; value: Promise<T> }>();

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs;
  }

  getOrCreate(key: string, factory: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }
    const value = factory();
    this.cache.set(key, { expiresAt: now + this.ttlMs, value });
    value.catch(() => {
      this.cache.delete(key);
    });
    return value;
  }
}

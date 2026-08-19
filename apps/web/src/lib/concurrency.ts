// Runs `worker` over `items` with at most `concurrency` in flight at once.
// Use for any loop that fires one HTTP request per item — an unbounded
// Promise.all over many reports/tabs can burst dozens of simultaneous
// requests at the server, saturating its database connection pool.
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, async () => {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await worker(items[current], current);
    }
  });
  await Promise.all(runners);
  return results;
}

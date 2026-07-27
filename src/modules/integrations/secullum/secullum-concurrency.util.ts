// Shared fan-out helper for the Secullum integration.
//
// Every "across all employees" endpoint here fans out one or more upstream
// calls per linked employee. Firing them all at once (Promise.allSettled over
// the full user list) reliably trips Secullum's rate limiter once the company
// has a couple dozen employees: the 429 backoff in makeAuthenticatedRequest
// eventually gives up, the call resolves as a failure, and the endpoint quietly
// returns a partial result that reads on screen as "no absences".
//
// Capping the fan-out costs a little wall-clock and removes that whole class of
// phantom-empty responses.

export const SECULLUM_FETCH_CONCURRENCY = 5;

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        results[i] = { status: 'fulfilled', value: await worker(items[i], i) };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  });
  await Promise.all(runners);
  return results;
}

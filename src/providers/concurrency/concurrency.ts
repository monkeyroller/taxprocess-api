/**
 * Runs `task` over `items` with at most `limit` in flight, preserving input order in the result.
 *
 * A whole currency table is ~49 independent SOAP calls: issuing them at once is unkind to the authority and
 * makes a single slow call indistinguishable from a hung batch. Deliberately not generalized into a
 * retry/queue abstraction — order-preserving concurrency is the whole requirement.
 *
 * A rejecting `task` rejects the whole call with the first error, as `Promise.all` would: which per-item
 * failures are tolerable is the caller's business.
 *
 * No further item is started once one has thrown. The rejection already ends the worker that hit it, so the
 * latch is for the case where the failure is a minority and the other workers would otherwise drain the
 * whole list around it. That is wrong whenever one failure means the batch is over, which is the shape the
 * rate fan-out has: it tolerates every per-code failure itself and rethrows only a refused delegate ticket,
 * which is shared. Continuing would spend a round trip per remaining item on a credential already known to
 * be rejected, and re-run the caller's eviction each time — where a late eviction purges a ticket another
 * request has since re-minted, and WSAA will not re-issue for ~12h.
 *
 * Items already in flight cannot be cancelled and still settle; only the tail is never begun.
 */
export async function mapWithConcurrency<T, R>(
    items: ReadonlyArray<T>,
    limit: number,
    task: (item: T, index: number) => Promise<R>,
): Promise<Array<R>> {
    const results = new Array<R>(items.length);
    let next = 0;
    let failed = false;

    // Each worker pulls the next index until the list is exhausted, so a slow item delays only itself rather
    // than a whole chunk — the reason this is not a `slice`-per-batch loop.
    const worker = async (): Promise<void> => {
        for (;;) {
            // Checked before claiming an index: a worker that has already taken one is committed to it.
            if (failed) {
                return;
            }
            const index = next++;
            if (index >= items.length) {
                return;
            }
            try {
                results[index] = await task(items[index], index);
            } catch (err) {
                // Set before rethrowing so the siblings see it on their next turn. `results` is left with
                // holes, which is safe because this path never returns it.
                failed = true;
                throw err;
            }
        }
    };

    const workers = Math.max(1, Math.min(limit, items.length));
    await Promise.all(Array.from({length: workers}, () => worker()));
    return results;
}

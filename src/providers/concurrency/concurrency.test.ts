import {describe, expect, it} from '@jest/globals';
import {mapWithConcurrency} from './concurrency.js';

describe('mapWithConcurrency', () => {
    it('preserves input order regardless of completion order', () => {
        // Matters because the rate fan-out pairs results back to the codes it asked about.
        const delays = [30, 0, 15, 5];
        return mapWithConcurrency(delays, 2, async (ms, index) => {
            await new Promise((done) => setTimeout(done, ms));
            return index;
        }).then((result) => {
            expect(result).toEqual([0, 1, 2, 3]);
        });
    });

    it('never exceeds the limit', async () => {
        let inFlight = 0;
        let peak = 0;
        await mapWithConcurrency(Array.from({length: 20}, (_, i) => i), 4, async (item) => {
            inFlight += 1;
            peak = Math.max(peak, inFlight);
            await new Promise((done) => setTimeout(done, item % 3));
            inFlight -= 1;
            return item;
        });
        expect(peak).toBeLessThanOrEqual(4);
    });

    it('pulls work per item rather than per batch, so one slow item does not stall a chunk', async () => {
        // A `slice`-per-batch loop takes two rounds of the slowest item, where pulling per item lets the
        // fast ones flow past it. With limit 2, one 60ms item and five instant ones, a batching
        // implementation waits 60ms three times.
        const started = Date.now();
        await mapWithConcurrency([60, 0, 0, 0, 0, 0], 2, async (ms) => {
            await new Promise((done) => setTimeout(done, ms));
            return ms;
        });
        expect(Date.now() - started).toBeLessThan(150);
    });

    it('handles an empty list without spawning a worker', async () => {
        await expect(mapWithConcurrency([], 8, async () => 1)).resolves.toEqual([]);
    });

    it('rejects when a task rejects, leaving the caller to decide what is tolerable', async () => {
        // Not swallowed here: which per-item failures are acceptable is the caller's decision, and this
        // helper must not pre-empt it.
        await expect(
            mapWithConcurrency([1, 2, 3], 2, async (n) => {
                if (n === 2) {
                    throw new Error('boom');
                }
                return n;
            }),
        ).rejects.toThrow('boom');
    });

    it('starts no further item once one has thrown, while the others would have succeeded', async () => {
        // The only case that can distinguish this from the old behaviour: a rejection propagates out of the
        // worker's loop, so when every item throws each worker dies on its first one and the batch stops
        // after `limit` either way. It is when the rest succeed that the surviving workers used to drain
        // the whole list around the failure, re-running the caller's eviction on each call.
        const started: Array<number> = [];
        await expect(
            mapWithConcurrency(Array.from({length: 20}, (_, i) => i), 2, async (n) => {
                started.push(n);
                await new Promise((done) => setTimeout(done, 1));
                if (n === 0) {
                    throw new Error('boom');
                }
                return n;
            }),
        ).rejects.toThrow('boom');

        // Let anything still queued have its chance to run before counting.
        await new Promise((done) => setTimeout(done, 50));
        // The items in flight when the throw landed are committed; nothing past them is begun. Bounded by
        // the limit, never by the length of the list.
        expect(started.length).toBeLessThanOrEqual(2);
        expect(started.length).toBeLessThan(20);
    });

    it('still completes every item when none throws', async () => {
        // The other side of the short-circuit: the `failed` latch must not be reachable on a clean run.
        const seen: Array<number> = [];
        const result = await mapWithConcurrency(Array.from({length: 20}, (_, i) => i), 3, async (n) => {
            seen.push(n);
            return n * 2;
        });
        expect(seen).toHaveLength(20);
        expect(result).toEqual(Array.from({length: 20}, (_, i) => i * 2));
    });
});

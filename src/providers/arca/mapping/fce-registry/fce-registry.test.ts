import {describe, expect, it, jest} from '@jest/globals';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

/**
 * Reading the vendored "empresas grandes" snapshot.
 *
 * The generated module is mocked rather than used, for two reasons: the committed one is a placeholder with
 * no rows, and a test asserting against real data would have to be rewritten every refresh — which is how a
 * test quietly stops asserting anything.
 */

const SNAPSHOT = {
    publishedAt: '2026-04-14',
    publishedAtRaw: 'Listado vigente desde el 14/04/2026',
    fetchedAt: '2026-09-01',
    sourceUrl: 'https://servicioscf.afip.gob.ar/facturadecreditoelectronica/Listado-RFCE-Mi-PyMe.asp',
    rowCount: 2,
    generalThreshold: {
        amount: 5549862,
        currencyCode: 'PES',
        effectiveFrom: '2026-04-14',
        instrument: 'Resolución 1/2026',
    },
};

jest.unstable_mockModule('./obligated-receivers.generated.js', () => ({
    FCE_REGISTRY_SNAPSHOT: SNAPSHOT,
    FCE_OBLIGATED_RECEIVER_ROWS: '30711111119\n30722222228',
}));

const {lookupObligatedReceiver, canAnswerFor} = await import('./fce-registry.js');

const OBLIGATED = '30711111119';
const NOT_LISTED = '20333333339';
/** An ARCA day after the listing took effect. */
const IN_RANGE = '20260917';

describe('lookupObligatedReceiver', () => {
    it('answers whole and labelled, so a voucher issued off it is identifiable afterwards', () => {
        const answer = lookupObligatedReceiver(OBLIGATED, IN_RANGE);

        expect(answer).toMatchObject({
            obligated: true,
            source: 'LOCAL_REGISTRY',
            threshold: {amount: 5549862, currencyCode: 'PES'},
            registrySnapshot: {publishedAt: '2026-04-14', fetchedAt: '2026-09-01'},
        });
    });

    it('dates the answer to when the listing took effect, not to now and not to when it was fetched', () => {
        // `now` would claim a currency the answer does not have; `fetchedAt` is when we copied the page,
        // which is not when the fact became true. Argentine midnight on `publishedAt`, rendered UTC.
        expect(lookupObligatedReceiver(OBLIGATED, IN_RANGE)?.asOf).toBe('2026-04-14T03:00:00Z');
    });

    it('omits the threshold for a receiver that is not obligated', () => {
        // There is no floor to state, and omitting it keeps the held figure out of most answers.
        const answer = lookupObligatedReceiver(NOT_LISTED, IN_RANGE);

        expect(answer?.obligated).toBe(false);
        expect(answer?.threshold).toBeUndefined();
    });

    it('declines to speak about a day before the listing took effect', () => {
        // A list published in April says nothing about February, when both the membership and the threshold
        // were different. Applying it backwards is the same mixing failure the live/cached split causes,
        // moved from "live obligado + stale threshold" to "current list + past day", and it is what stops
        // the dated observation quietly becoming a constant.
        expect(lookupObligatedReceiver(OBLIGATED, '20260213')).toBeUndefined();
        expect(canAnswerFor('20260213')).toBe(false);
    });

    it('answers on the day the listing takes effect', () => {
        expect(canAnswerFor('20260414')).toBe(true);
    });

    it('has no staleness expiry, so a long-unrefreshed list still answers', () => {
        // Deliberate: "older than N days, decline" converts a working fallback into a 502 on a schedule
        // nobody is watching. The dates go out on the wire; judging them is the caller's business.
        expect(canAnswerFor('20301231')).toBe(true);
        expect(lookupObligatedReceiver(OBLIGATED, '20301231')?.obligated).toBe(true);
    });
});

describe('the general threshold figure', () => {
    it('appears only in the generated file, and nowhere else in the source tree', () => {
        // Core asked that nobody hold this figure as a constant. What the fallback holds instead is a dated,
        // attributed observation in a machine-written file — and the difference between those two is only
        // real if it is checked. This fails loudly the first time somebody inlines the number into a
        // validator, a default or a test fixture.
        //
        // The needle comes from the COMMITTED snapshot, not from this file's mock. Greping for a figure only
        // the test holds can never match anything, so the guard would pass forever while the real number was
        // being copied around — which is exactly the way a check quietly stops checking. `0` is the
        // placeholder's value: there is no figure to leak yet, and searching for it would match everything.
        const amount = committedThresholdAmount();
        const offenders =
            amount === 0
                ? []
                : sourceFilesContaining(String(amount)).filter(
                      (path) =>
                          !path.endsWith('obligated-receivers.generated.ts') &&
                          !path.endsWith('fce-registry.test.ts'),
                  );

        expect(offenders).toEqual([]);
    });
});

/** The `generalThreshold.amount` the committed generated file actually holds — `0` while it is a placeholder. */
function committedThresholdAmount(): number {
    // Read as text rather than imported: the generated module is mocked in this file, so importing it would
    // hand back the fixture above and reintroduce the very problem this reads around.
    const generated = readFileSync(
        fileURLToPath(new URL('./obligated-receivers.generated.ts', import.meta.url)),
        'utf8',
    );
    return Number(/amount:\s*(\d+)/.exec(generated)?.[1] ?? '0');
}

/** Every `.ts` under `src/` whose text contains `needle`. */
function sourceFilesContaining(needle: string): Array<string> {
    // `fileURLToPath`, not `.pathname`: this repo lives under a directory with a space in its name, which
    // a URL percent-encodes and `readdirSync` then cannot find.
    const root = fileURLToPath(new URL('../../../../', import.meta.url));
    const found: Array<string> = [];

    const walk = (dir: string): void => {
        for (const entry of readdirSync(dir, {withFileTypes: true})) {
            const path = join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(path);
            } else if (entry.name.endsWith('.ts') && readFileSync(path, 'utf8').includes(needle)) {
                found.push(path);
            }
        }
    };

    walk(root);
    return found;
}

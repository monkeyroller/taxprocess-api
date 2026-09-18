import {describe, expect, it, jest} from '@jest/globals';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

/**
 * Reading the vendored "empresas grandes" snapshot.
 *
 * The generated module is mocked rather than used: a test asserting against the real ~1,180 rows would have
 * to be rewritten every refresh, which is how a test quietly stops asserting anything. The one case that
 * *does* read the committed file is the figure guard at the bottom, and it says why.
 */

/** Read 2026-09-18. `fetchedAt` is the floor, and there is deliberately no publication date — see the reader. */
const SNAPSHOT = {
    fetchedAt: '2026-09-01',
    sourceUrl: 'https://servicioscf.afip.gob.ar/facturadecreditoelectronica/Listado-RFCE-Mi-PyMe.asp',
    rowCount: 3,
    generalThreshold: {
        amount: 5549862,
        currencyCode: 'PES',
        effectiveFrom: '2026-04-14',
        instrument: 'Resolución 1/2026',
    },
};

/** Obligated since well before the snapshot; obligated only from a later alta; and a future alta. */
const OBLIGATED = '30711111119';
const RECENT = '30722222228';
const FUTURE_ALTA = '30733333337';
const NOT_LISTED = '20333333339';

jest.unstable_mockModule('./obligated-receivers.generated.js', () => ({
    FCE_REGISTRY_SNAPSHOT: SNAPSHOT,
    FCE_OBLIGATED_RECEIVERS: {
        [OBLIGATED]: {since: '2019-10-01', name: 'ACME SA'},
        [RECENT]: {since: '2026-09-01', name: 'RECIENTE SRL'},
        [FUTURE_ALTA]: {since: '2026-12-01', name: 'FUTURA SA'},
    },
}));

const {lookupObligatedReceiver, canAnswerFor} = await import('./fce-registry.js');

/** An ARCA day after the snapshot was read. */
const IN_RANGE = '20260917';

describe('lookupObligatedReceiver', () => {
    it('answers whole and labelled, so a voucher issued off it is identifiable afterwards', () => {
        const answer = lookupObligatedReceiver(OBLIGATED, IN_RANGE);

        expect(answer).toMatchObject({
            obligated: true,
            source: 'LOCAL_REGISTRY',
            threshold: {amount: 5549862, currencyCode: 'PES'},
            registrySnapshot: {fetchedAt: '2026-09-01', thresholdEffectiveFrom: '2026-04-14'},
        });
    });

    it('dates the answer to when the snapshot was read, not to now', () => {
        // `now` would claim a currency the answer does not have. Argentine midnight on `fetchedAt`, UTC.
        expect(lookupObligatedReceiver(OBLIGATED, IN_RANGE)?.asOf).toBe('2026-09-01T03:00:00Z');
    });

    it('omits the threshold for a receiver that is not obligated', () => {
        // There is no floor to state, and omitting it keeps the held figure out of most answers.
        const answer = lookupObligatedReceiver(NOT_LISTED, IN_RANGE);

        expect(answer?.obligated).toBe(false);
        expect(answer?.threshold).toBeUndefined();
    });

    it('does not report a listed company as obligated before its own alta takes effect', () => {
        // The rule the per-row day exists for, and the expensive direction to get wrong. ARCA notifies the
        // year's universe in May but its altas take effect in September, so the listing legitimately holds
        // companies that owe nothing yet — answering `true` issues a credit invoice months early.
        expect(lookupObligatedReceiver(FUTURE_ALTA, IN_RANGE)?.obligated).toBe(false);
        expect(lookupObligatedReceiver(FUTURE_ALTA, '20261201')?.obligated).toBe(true);
    });

    it('reports a company obligated from the day its alta takes effect, not the day after', () => {
        expect(lookupObligatedReceiver(RECENT, '20260901')?.obligated).toBe(true);
    });

    it('names the listed company, so "why was this an FCE" has an answer in words', () => {
        // Nothing reads the name to decide anything. It is here so an operator reading a stored verdict
        // months later is not left holding an eleven-digit number.
        expect(lookupObligatedReceiver(OBLIGATED, IN_RANGE)?.providerMetadata).toMatchObject({
            receiverName: 'ACME SA',
            obligatedSince: '2019-10-01',
        });
    });

    it('says nothing about a receiver it does not hold, rather than naming an empty one', () => {
        // `obligated: false` covers both "not listed" and "listed but not yet". Only the second can say
        // since when, so the absence of these keys is itself the distinction.
        const metadata = lookupObligatedReceiver(NOT_LISTED, IN_RANGE)?.providerMetadata ?? {};

        expect(metadata).not.toHaveProperty('receiverName');
        expect(metadata).not.toHaveProperty('obligatedSince');
    });

    it('declines to speak about a day before the snapshot was read', () => {
        // Bajas take effect in July and a removed company is simply gone from the listing, so for an
        // earlier voucher this cannot tell "never obligated" from "no longer obligated". The floor is the
        // read date because ARCA publishes no date of its own.
        expect(lookupObligatedReceiver(OBLIGATED, '20260213')).toBeUndefined();
        expect(canAnswerFor('20260213')).toBe(false);
    });

    it('answers on the day the snapshot was read', () => {
        expect(canAnswerFor('20260901')).toBe(true);
    });

    it('has no staleness expiry, so a long-unrefreshed snapshot still answers', () => {
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
        // The needle comes from the COMMITTED snapshot, not from this file's mock. Grepping for a figure
        // only the test holds can never match anything, so the guard would pass forever while the real
        // number was being copied around — exactly the way a check quietly stops checking.
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

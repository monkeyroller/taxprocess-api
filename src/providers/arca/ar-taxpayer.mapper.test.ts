import {describe, expect, it} from '@jest/globals';
import {toNeutralTaxpayerResult} from './ar-taxpayer.mapper.js';
import type {TaxpayerData} from './sdk/index.js';

/**
 * The neutral taxpayer wire shape. What matters here is not the copying — it is the ABSENCE rules the
 * contract promises callers, which only show up once the result is serialized: optional scalars are
 * omitted rather than sent as `null`, the arrays a detail covers are always present (so "none registered"
 * is distinguishable from "this detail cannot report it"), and `taxes` appears on exactly the detail that
 * can report taxes. So every assertion runs against the JSON, not the object.
 */

function registration(overrides: Partial<TaxpayerData> = {}): TaxpayerData {
    return {
        detail: 'REGISTRATION',
        taxId: '20111111112',
        registrationStatus: 'ACTIVE',
        addresses: [],
        activities: [],
        taxes: [],
        providerMetadata: {service: 'ws_sr_constancia_inscripcion'},
        ...overrides,
    };
}

function identity(overrides: Partial<TaxpayerData> = {}): TaxpayerData {
    return {
        detail: 'IDENTITY',
        taxId: '27117096764',
        documentNumber: '11709676',
        addresses: [],
        activities: [],
        providerMetadata: {service: 'ws_sr_padron_a13'},
        ...overrides,
    };
}

/** What the caller actually receives — `res.json` drops `undefined`-valued keys. */
function onTheWire(...people: Array<TaxpayerData>): any {
    return JSON.parse(JSON.stringify(toNeutralTaxpayerResult('ARCA', people)));
}

describe('toNeutralTaxpayerResult', () => {
    it('describes itself: the entity that answered and the detail that shapes the entries', () => {
        const result = onTheWire(registration());

        expect(result.entityCode).toBe('ARCA');
        expect(result.detail).toBe('REGISTRATION');
        expect(result.taxpayers).toHaveLength(1);
    });

    it('refuses an empty list by name, rather than reading `detail` off nothing', () => {
        // The invariant is the provider's (no match is a TaxpayerNotFoundError), but it is enforced here too:
        // a broken guard should fail saying which invariant broke, not as an anonymous property access.
        expect(() => toNeutralTaxpayerResult('ARCA', [])).toThrow(/at least one taxpayer/);
    });

    it('omits scalars the authority did not return — never null', () => {
        const [taxpayer] = onTheWire(registration()).taxpayers;

        for (const key of ['name', 'firstName', 'lastName', 'taxIdType', 'personType', 'fiscalAddress']) {
            expect(taxpayer).not.toHaveProperty(key);
        }
        expect(JSON.stringify(taxpayer)).not.toContain('null');
    });

    it('always sends the arrays a detail covers, so empty means "none registered"', () => {
        const [taxpayer] = onTheWire(registration()).taxpayers;

        expect(taxpayer.addresses).toEqual([]);
        expect(taxpayer.activities).toEqual([]);
        expect(taxpayer.taxes).toEqual([]);
        expect(taxpayer.providerMetadata).toEqual({service: 'ws_sr_constancia_inscripcion'});
    });

    it('leaves out taxes entirely on an IDENTITY result — the registry cannot report them', () => {
        const [taxpayer] = onTheWire(identity()).taxpayers;

        expect(taxpayer).not.toHaveProperty('taxes');
        expect(taxpayer).not.toHaveProperty('simplifiedRegimeCategory');
        expect(taxpayer.addresses).toEqual([]);
        expect(taxpayer.activities).toEqual([]);
    });

    it('drops blank members inside nested addresses too', () => {
        const result = onTheWire(
            registration({
                fiscalAddress: {street: 'SANTA FE 7516', kind: 'FISCAL'},
                addresses: [{street: 'SANTA FE 7516', kind: 'FISCAL'}],
            }),
        );

        expect(result.taxpayers[0].fiscalAddress).toEqual({street: 'SANTA FE 7516', kind: 'FISCAL'});
    });

    it('carries every match of a document lookup, in order', () => {
        const result = onTheWire(identity({taxId: '23117096769'}), identity({taxId: '27117096764'}));

        expect(result.detail).toBe('IDENTITY');
        expect(result.taxpayers.map((t: {taxId: string}) => t.taxId)).toEqual(['23117096769', '27117096764']);
    });
});

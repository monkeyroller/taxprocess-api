import {describe, expect, it} from '@jest/globals';
import {toNeutralTaxpayerResult} from './ar-taxpayer.mapper.js';
import {AddressCodeScheme} from '../provider.js';
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

        // The country pair is the one that never depends on what ARCA returned — every address an ARCA
        // registry holds is Argentine. The region and city pairs are absent precisely because this address
        // states neither, which is what makes a partially-coded address normal rather than a fault.
        expect(result.taxpayers[0].fiscalAddress).toEqual({
            street: 'SANTA FE 7516',
            kind: 'FISCAL',
            countryCode: 'AR',
            countryCodeScheme: 'ISO-3166-1-ALPHA-2',
        });
    });

    it('codes every level as a pair: the code, and the standard it belongs to', () => {
        const address = {
            street: 'SANTA FE 7516',
            city: 'CORDOBA',
            postalCode: '5000',
            region: 'CORDOBA',
            regionCode: '3', // ARCA's idProvincia — an SDK-level value, not a wire one
            kind: 'FISCAL',
        };
        const [taxpayer] = onTheWire(registration({fiscalAddress: address, addresses: [address]})).taxpayers;

        expect(taxpayer.fiscalAddress).toMatchObject({
            countryCode: 'AR',
            countryCodeScheme: 'ISO-3166-1-ALPHA-2',
            regionCode: 'AR-X',
            regionCodeScheme: 'ISO-3166-2',
            cityCode: '14014010',
            cityCodeScheme: 'INDEC',
        });
        // The authority's own names survive alongside the codes, as the fallback for an unresolved level.
        expect(taxpayer.fiscalAddress).toMatchObject({region: 'CORDOBA', city: 'CORDOBA'});
    });

    it('never lets ARCA’s own province id reach the wire', () => {
        // `regionCode` means idProvincia on the SDK type and ISO 3166-2 on the wire. If the mapper ever
        // regresses to a passthrough the value is still a plausible-looking string, so nothing else here
        // would fail — this is the assertion that catches it.
        const address = {region: 'CORDOBA', regionCode: '3', kind: 'FISCAL'};
        const [taxpayer] = onTheWire(registration({fiscalAddress: address, addresses: [address]})).taxpayers;

        expect(taxpayer.fiscalAddress.regionCode).toBe('AR-X');
        expect(JSON.stringify(taxpayer.fiscalAddress)).not.toContain('"3"');
    });

    it('omits a level’s code and scheme together when that level does not resolve', () => {
        // A barrio of an interior city — real, and not something the national catalog codes. The province
        // still resolves, so the address is partially coded rather than not coded at all.
        const address = {city: 'BARRIO YAPEYU', regionCode: '3', kind: 'FISCAL'};
        const [taxpayer] = onTheWire(registration({fiscalAddress: address, addresses: [address]})).taxpayers;

        expect(taxpayer.fiscalAddress).not.toHaveProperty('cityCode');
        expect(taxpayer.fiscalAddress).not.toHaveProperty('cityCodeScheme');
        expect(taxpayer.fiscalAddress).toMatchObject({regionCode: 'AR-X', regionCodeScheme: 'ISO-3166-2'});
        expect(taxpayer.fiscalAddress.city).toBe('BARRIO YAPEYU');
    });

    it('omits the region pair when the province is one ARCA’s own table does not name', () => {
        const address = {region: 'ATLANTIDA', regionCode: '15', city: 'CORDOBA', kind: 'FISCAL'};
        const [taxpayer] = onTheWire(registration({fiscalAddress: address, addresses: [address]})).taxpayers;

        expect(taxpayer.fiscalAddress).not.toHaveProperty('regionCode');
        expect(taxpayer.fiscalAddress).not.toHaveProperty('regionCodeScheme');
        // The locality is scoped by province, so it cannot resolve either — but the country still can.
        expect(taxpayer.fiscalAddress).not.toHaveProperty('cityCode');
        expect(taxpayer.fiscalAddress).toMatchObject({countryCode: 'AR', region: 'ATLANTIDA'});
    });

    it('never sends a scheme without its code, or a scheme outside the shared vocabulary', () => {
        const coded = {city: 'CORDOBA', regionCode: '3', kind: 'FISCAL'};
        const uncoded = {street: 'SANTA FE 7516', kind: 'FISCAL'};
        const schemes = new Set<string>(Object.values(AddressCodeScheme));

        for (const address of [coded, uncoded]) {
            const [taxpayer] = onTheWire(registration({addresses: [address]})).taxpayers;
            const [onWire] = taxpayer.addresses;

            for (const level of ['country', 'region', 'city']) {
                expect(onWire[`${level}CodeScheme`] === undefined).toBe(onWire[`${level}Code`] === undefined);
                if (onWire[`${level}CodeScheme`] !== undefined) {
                    expect(schemes.has(onWire[`${level}CodeScheme`])).toBe(true);
                }
            }
        }
    });

    it('sends the fiscal condition it can derive, and no key at all when it cannot', () => {
        const [inscripto] = onTheWire(
            registration({taxes: [{code: '30', description: 'IVA', status: 'AC'}]}),
        ).taxpayers;
        expect(inscripto.fiscalConditionCode).toBe(1);

        const [unknown] = onTheWire(
            registration({taxes: [{code: '2015', description: 'DERECHO ESPECIFICO', status: 'AC'}]}),
        ).taxpayers;
        expect(unknown).not.toHaveProperty('fiscalConditionCode');
    });

    it('makes each row self-describing, so a document match is not read as the document', () => {
        // The operator typed a DNI; the customer core builds must be keyed by the row's own clave. Each
        // row therefore states its own identification pair rather than inheriting the request's.
        const result = onTheWire(
            identity({taxId: '23117096769', taxIdType: 'CUIL'}),
            identity({taxId: '27117096764', taxIdType: 'CUIT'}),
        );

        expect(result.taxpayers.map((t: {identificationTypeCode: number}) => t.identificationTypeCode)) //
            .toEqual([86, 80]);
        expect(result.taxpayers.map((t: {identificationNumber: string}) => t.identificationNumber)) //
            .toEqual(['23117096769', '27117096764']);
    });

    it('keeps the identification number but drops the type when ARCA stated no kind', () => {
        const [taxpayer] = onTheWire(identity()).taxpayers;

        expect(taxpayer.identificationNumber).toBe('27117096764');
        expect(taxpayer).not.toHaveProperty('identificationTypeCode');
        expect(JSON.stringify(taxpayer)).not.toContain('null');
    });

    it('carries every match of a document lookup, in order', () => {
        const result = onTheWire(identity({taxId: '23117096769'}), identity({taxId: '27117096764'}));

        expect(result.detail).toBe('IDENTITY');
        expect(result.taxpayers.map((t: {taxId: string}) => t.taxId)).toEqual(['23117096769', '27117096764']);
    });
});

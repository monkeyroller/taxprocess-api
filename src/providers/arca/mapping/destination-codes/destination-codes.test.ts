import {describe, expect, it} from '@jest/globals';
import {
    DESTINATIONS,
    DESTINATION_AAE_TIERRA_DEL_FUEGO,
    isKnownCountryTaxId,
    isKnownDestinationCode,
    normalizeDestinationCode,
    toCountryTaxId,
    toDstCmp,
} from './destination-codes.js';
import {ArcaValidationError} from '../../sdk/core/errors.js';

describe('DESTINATIONS', () => {
    it('carries the whole production table', () => {
        expect(DESTINATIONS.size).toBe(310);
    });

    it('names the AAE, which is the row the export feature exists for', () => {
        expect(DESTINATION_AAE_TIERRA_DEL_FUEGO).toBe('250');
        expect(DESTINATIONS.get('250')).toBe('AAE Tierra del Fuego - ARGENTINA');
    });

    it('carries the destinations ISO cannot express', () => {
        // The reason the authority's code is on the wire at all. A zona franca is its own destination, not
        // a refinement of the country it sits in -- 280 and 225 are both present and distinct.
        expect(DESTINATIONS.get('280')).toBe('ZF Colonia - URUGUAY');
        expect(DESTINATIONS.get('225')).toBe('URUGUAY');
        expect(DESTINATIONS.get('297')).toBe('RESTO AMERICA');
        expect(DESTINATIONS.get('265')).toBe('SECTOR ANTARTICO ARG.');
    });

    it('publishes no ISO annotation on any row', () => {
        // Deliberate, and 254 is why: ISO assigns that destination to FK, so annotating it would have this
        // service state a sovereignty position in a lookup table. A bulk transcription would do it silently.
        expect(DESTINATIONS.get('254')).toBe('ARGENTINA - ISLAS MALVINAS');
        for (const value of DESTINATIONS.values()) {
            expect(typeof value).toBe('string');
        }
    });
});

describe('normalizeDestinationCode', () => {
    it('zero-pads to three digits, so a short code cannot match a longer one', () => {
        expect(normalizeDestinationCode('25')).toBe('025');
        expect(normalizeDestinationCode(' 250 ')).toBe('250');
        expect(normalizeDestinationCode('1')).toBe('001');
    });

    it('leaves a non-numeric value alone rather than padding nonsense', () => {
        expect(normalizeDestinationCode('AAE')).toBe('AAE');
    });
});

describe('toDstCmp', () => {
    it('is the identity for a known code', () => {
        expect(toDstCmp('250')).toBe(250);
        expect(toDstCmp(' 203 ')).toBe(203);
    });

    it('refuses an unknown code with UNKNOWN_CODE, naming the field', () => {
        // A 400 naming the field beats a 502 relaying ARCA's own rejection.
        expect(() => toDstCmp('999')).toThrow(ArcaValidationError);
        try {
            toDstCmp('999');
        } catch (err) {
            expect((err as ArcaValidationError).code).toBe('UNKNOWN_CODE');
        }
    });

    it('refuses a code that only looks like a destination', () => {
        expect(isKnownDestinationCode('250')).toBe(true);
        expect(isKnownDestinationCode('251')).toBe(true);
        expect(isKnownDestinationCode('999')).toBe(false);
    });
});

describe('country tax ids (Cuit_pais_cliente)', () => {
    it('carries the whole published set', () => {
        expect(isKnownCountryTaxId('50000000016')).toBe(true); // URUGUAY - Persona Física
        expect(isKnownCountryTaxId('50000000059')).toBe(true); // BRASIL - Persona Física
        expect(isKnownCountryTaxId('55000002126')).toBe(true); // ESTADOS UNIDOS - Persona Jurídica
    });

    it('refuses one the authority does not publish', () => {
        expect(isKnownCountryTaxId('20111111112')).toBe(false);
        expect(() => toCountryTaxId('20111111112')).toThrow(ArcaValidationError);
    });

    it('holds no value derivable from a destination code', () => {
        // Pinning the finding this design rests on: the CUIT does not encode the país code. ESTADOS UNIDOS
        // (país 212) is 50000002124, whose body IS 212; but URUGUAY (225) is 50000000016 and BRASIL (203)
        // is 50000000059 -- a legacy sequence. So there is no arithmetic to derive, and no join key either.
        expect(isKnownCountryTaxId('50000002124')).toBe(true);
        expect(isKnownCountryTaxId('50000002254')).toBe(false);
        expect(isKnownCountryTaxId('50000002034')).toBe(false);
    });
});

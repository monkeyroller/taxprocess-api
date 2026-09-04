import {ArcaValidationError} from '../sdk/core/errors.js';

/**
 * Parses an all-digits ARCA identifier string into a number. The neutral contract carries these as strings,
 * so this guard turns a non-numeric or empty value into a `400` rather than letting a malformed id reach
 * ARCA as `NaN`.
 */
export function parseArcaId(value: string, field: string): number {
    if (!/^\d+$/.test(value)) {
        throw new ArcaValidationError(`${field} must be all digits, got "${value}"`, 'INVALID_ID');
    }
    return Number(value);
}

/**
 * Canonicalizes an issuer CUIT to its bare 11-digit form, so `"20-11111111-2"` and a certificate's
 * `"CUIT 20111111112"` compare equal. `null` when the value does not reduce to exactly 11 digits.
 *
 * For the issuer taxpayer id only, which is always a CUIT. Receiver ids carry their own document type and
 * are normalized where that type is known, so comparisons only ever match ids of the same kind.
 */
export function canonicalCuit(value: string): string | null {
    const digits = value.replace(/\D/g, '');
    return /^\d{11}$/.test(digits) ? digits : null;
}

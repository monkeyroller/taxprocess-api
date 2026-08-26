import {ArcaValidationError} from '../sdk/index.js';

/**
 * Parses an all-digits ARCA identifier string (issuer CUIT, receiver `DocNro`, taxpayer id) into a
 * number. The neutral contract carries these as strings ("digits as a string"); this guard rejects a
 * non-numeric/empty value with an `ArcaValidationError` (→ `400`) so a malformed id can never silently
 * reach ARCA (or the RG-4892 QR / WSAA `Auth`) as `NaN`.
 */
export function parseArcaId(value: string, field: string): number {
    if (!/^\d+$/.test(value)) {
        throw new ArcaValidationError(`${field} must be all digits, got "${value}"`, 'INVALID_ID');
    }
    return Number(value);
}

/**
 * Canonicalizes an issuer/company CUIT to its bare 11-digit form so differently-formatted spellings of the
 * same id compare equal: `"20-11111111-2"`, `"20111111112"`, and a certificate's `"CUIT 20111111112"` all
 * canonicalize to `"20111111112"`. Returns `null` when the value does not reduce to exactly 11 digits.
 *
 * This is the normalization rule for the issuer taxpayer id, which is always a CUIT. Receiver ids carry
 * their own document type (`DocTipo`: CUIT / DNI / consumidor final) and are normalized where that type
 * is known, not here — so comparisons only ever match ids of the same kind.
 */
export function canonicalCuit(value: string): string | null {
    const digits = value.replace(/\D/g, '');
    return /^\d{11}$/.test(digits) ? digits : null;
}

import {ArcaValidationError} from './sdk/index.js';

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

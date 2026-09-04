import {ArcaValidationError} from '../../sdk/core/errors.js';
import {TaxProcessIdentificationTypeCode} from '../canonical-codes.js';
import {toDocTipo} from '../code-maps/code-maps.js';
import type {PadronService} from '../../sdk/taxpayer-registry/padron.types.js';

/**
 * Which ARCA padrón service can answer for a given identification type, and how the registry's own
 * `tipoClave` wording reads back as a canonical code. Both directions of the padrón's identification
 * vocabulary, kept apart from the canonical→ARCA code translation in `code-maps.ts`.
 */

/**
 * ARCA's `tipoClave` wording → the canonical `identificationTypeCode`, so a taxpayer row names the kind of
 * identifier it is keyed by rather than leaving a caller to infer it from the digits, which cannot be done:
 * CUIT, CUIL and CDI share the same prefixes.
 *
 * Runs the opposite direction from `toDocTipo`, which validates a code a caller sent us, so it never throws.
 * An unrecognized or missing `tipoClave` yields `undefined` and the key is omitted — claiming a type ARCA
 * did not state would be worse than leaving core to its existing fallback.
 */
const IDENTIFICATION_TYPE_BY_CLAVE_KIND: ReadonlyMap<string, TaxProcessIdentificationTypeCode> = new Map([
    ['CUIT', TaxProcessIdentificationTypeCode.CUIT],
    ['CUIL', TaxProcessIdentificationTypeCode.CUIL],
    ['CDI', TaxProcessIdentificationTypeCode.CDI],
]);

/** The canonical identification type for an ARCA `tipoClave` (`"CUIT"`/`"CUIL"`/`"CDI"`), if it names one. */
export function identificationTypeForClaveKind(
    claveKind: string | undefined,
): TaxProcessIdentificationTypeCode | undefined {
    if (claveKind === undefined) {
        return undefined;
    }
    return IDENTIFICATION_TYPE_BY_CLAVE_KIND.get(claveKind.trim().toUpperCase());
}

/**
 * Routes a canonical `identificationTypeCode` to the ARCA padrón service that can answer for it, which is
 * why `/taxpayers/lookup` needs no "which service" knob on the wire.
 *
 * A clave tributaria goes to the constancia service, which returns the registration picture. That is where a
 * clave lookup begins rather than which padrón ends up answering: the constancia holds only claves with an
 * inscripción, so a miss falls back to A13 and the reply can come back as either detail.
 *
 * An identity document is not a clave, so it goes to A13, the only padrón service that can resolve a
 * document number to the claves issued for it.
 *
 * Passport, foreign CI and "sin identificar" are refused as a `400`: ARCA's document search takes a bare
 * number with no document type, so there is no way to ask it about a passport, and code 99 names no person.
 */
export function toPadronService(identificationTypeCode: number): PadronService {
    // Validated first, so an entirely unknown code keeps the shared `UNKNOWN_CODE` reason rather than
    // reporting an identification type ARCA merely cannot look up.
    const code = toDocTipo(identificationTypeCode);
    if (CLAVE_IDENTIFICATION_TYPES.has(code)) {
        return 'CONSTANCIA';
    }
    if (DOCUMENT_IDENTIFICATION_TYPES.has(code)) {
        return 'A13';
    }
    throw new ArcaValidationError(
        `No ARCA padrón service can look up identification type ${code}`,
        'UNSUPPORTED_IDENTIFICATION_TYPE',
    );
}

/**
 * Identification types that are a clave tributaria, so the constancia service can be asked directly. Derived
 * from the map above rather than listed again — the two are the same codes seen from opposite directions, so
 * a fourth kind of clave added only to the map would otherwise be routed to A13 in silence.
 */
const CLAVE_IDENTIFICATION_TYPES: ReadonlySet<number> = new Set(
    IDENTIFICATION_TYPE_BY_CLAVE_KIND.values(),
);

/**
 * Identification types that are a plain numeric identity document, which A13 can resolve to the claves
 * issued for it. Passport and foreign CI are absent because ARCA's document search takes a bare number with
 * no document type.
 */
const DOCUMENT_IDENTIFICATION_TYPES: ReadonlySet<number> = new Set([
    TaxProcessIdentificationTypeCode.DNI,
    TaxProcessIdentificationTypeCode.LE,
    TaxProcessIdentificationTypeCode.LC,
]);

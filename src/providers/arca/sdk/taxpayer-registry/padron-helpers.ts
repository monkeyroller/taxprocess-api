// ---- Padrón wire helpers ----

import type {PadronAddress, PersonType, RegistrationStatus, TaxpayerData} from './padron.types.js';

/**
 * The SOAP parser runs with `parseTagValue: false`, so every padrón field arrives as a string and an
 * empty element (`<razonSocial/>`) reads as `''`. These helpers turn that raw shape into the SDK types,
 * treating blank as "not returned" rather than as a value.
 */

/** Trimmed text, or `undefined` for a missing/blank element. */
export function text(value: unknown): string | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }
    const s = String(value).trim();
    return s === '' ? undefined : s;
}

/** A finite integer, or `undefined` when missing/blank/unparseable (never a silent `0`). */
export function integer(value: unknown): number | undefined {
    const s = text(value);
    if (s === undefined) {
        return undefined;
    }
    const n = Number(s);
    return Number.isInteger(n) ? n : undefined;
}

/**
 * Normalizes fast-xml-parser's single-vs-array output to an array. A repeated element (`<impuesto>` ×3)
 * parses as an array, a single occurrence as a bare object, and an absent one as `undefined` — all three
 * must read as a list.
 */
export function asArray(node: unknown): Array<Record<string, any>> {
    if (node === undefined || node === null) {
        return [];
    }
    return (Array.isArray(node) ? node : [node]) as Array<Record<string, any>>;
}

/**
 * An ISO-8601 calendar date (`YYYY-MM-DD`) from either padrón date spelling: the XSD `dateTime` A13
 * returns (`1936-02-11T12:00:00-03:00`) or the compact `YYYYMMDD` the caracterizaciones use. The date
 * part is taken verbatim rather than parsed into a `Date` — these are ARCA calendar dates, and running
 * them through UTC could shift the day.
 */
export function isoDate(value: unknown): string | undefined {
    const s = text(value);
    if (s === undefined) {
        return undefined;
    }
    const dateTime = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]|$)/.exec(s);
    if (dateTime !== null) {
        return `${dateTime[1]}-${dateTime[2]}-${dateTime[3]}`;
    }
    const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
    return compact === null ? undefined : `${compact[1]}-${compact[2]}-${compact[3]}`;
}

/**
 * An ISO-8601 year-month (`2014-09`) from ARCA's `AAAAMM` period. Some elements carry a full `AAAAMMDD`
 * (e.g. a caracterización's `19010101`), which is truncated to its year-month. A value in neither shape
 * is returned as-is rather than dropped — the period is informational, never keyed on.
 */
export function isoPeriod(value: unknown): string | undefined {
    const s = text(value);
    if (s === undefined) {
        return undefined;
    }
    const match = /^(\d{4})(\d{2})(?:\d{2})?$/.exec(s);
    return match === null ? s : `${match[1]}-${match[2]}`;
}

/** `FISICA` → `INDIVIDUAL`, `JURIDICA` → `LEGAL_ENTITY`; anything else is left unreported. */
export function personType(value: unknown): PersonType | undefined {
    const s = text(value)?.toUpperCase();
    if (s === undefined) {
        return undefined;
    }
    if (s.startsWith('FISICA') || s.startsWith('FÍSICA')) {
        return 'INDIVIDUAL';
    }
    return s.startsWith('JURIDICA') || s.startsWith('JURÍDICA') ? 'LEGAL_ENTITY' : undefined;
}

/**
 * `ACTIVO` → `ACTIVE`, anything else ARCA reports (`INACTIVO`, and the several blocked/cancelled
 * wordings in the constancia manual's validation table) → `INACTIVE`. Only a missing `estadoClave` is
 * left unreported: "not active" is the safe reading of every non-`ACTIVO` state.
 */
export function registrationStatus(value: unknown): RegistrationStatus | undefined {
    const s = text(value)?.toUpperCase();
    if (s === undefined) {
        return undefined;
    }
    return s === 'ACTIVO' ? 'ACTIVE' : 'INACTIVE';
}

/** Maps one ARCA `domicilio`/`domicilioFiscal` element to {@link PadronAddress}. */
export function address(node: Record<string, any>): PadronAddress {
    return {
        street: text(node.direccion),
        // A13 spells it `codigoPostal`, constancia `codPostal`.
        city: text(node.localidad),
        postalCode: text(node.codigoPostal) ?? text(node.codPostal),
        region: text(node.descripcionProvincia),
        regionCode: text(node.idProvincia),
        kind: text(node.tipoDomicilio),
        status: text(node.estadoDomicilio),
    };
}

/** The `FISCAL`-typed address out of a parsed list, when the service reported one. */
export function fiscalAddressOf(addresses: ReadonlyArray<PadronAddress>): PadronAddress | undefined {
    return addresses.find((a) => a.kind?.toUpperCase() === 'FISCAL');
}

// ---- Did the authority say anything? ----

/**
 * How a {@link TaxpayerData} member relates to what the AUTHORITY told us about the person we asked about.
 *
 * - `ECHO` — the request handed back, or a fact about which service answered. `taxId` is the very number
 *   the caller asked with (both services fall back to it when the response omits `idPersona`), `taxIdType`
 *   is derivable from that number, and `detail` names the padrón that replied. None of the three is
 *   evidence that a padrón holds this taxpayer — and they are why an answer with nothing in it looks
 *   *almost* populated rather than obviously blank.
 * - `DIAGNOSTIC` — `providerMetadata`, which carries `errorConstancia` and is therefore populated
 *   *precisely* when the constancia declined to report a clave. Counting it as content would invert
 *   {@link identifiesNoTaxpayer} in the only case that matters.
 * - `SITUATION` — what the taxpayer is registered FOR. Real authority content, but it names nobody: a
 *   cancelled clave can come back with an empty `datosGenerales` and a dangling `impuesto` still listed in
 *   `datosRegimenGeneral`, which is a fragment of a registration rather than an answer about a person.
 * - `IDENTITY` — who the taxpayer is and what state their clave is in. One populated member HERE is what
 *   makes a response an answer, because it is the only group a caller can read the taxpayer out of.
 */
type TaxpayerFieldOrigin = 'ECHO' | 'DIAGNOSTIC' | 'SITUATION' | 'IDENTITY';

/**
 * Every member of {@link TaxpayerData}, classified.
 *
 * Exhaustive by type (`Record<keyof TaxpayerData, …>`) rather than a list of the fields that count: a
 * member added to the interface then fails to compile until it is classified here, which is the only thing
 * that stops {@link identifiesNoTaxpayer} from silently weakening as the shape grows. A comment asking for
 * the same discipline would be forgotten exactly once.
 */
const TAXPAYER_FIELD_ORIGIN: Readonly<Record<keyof TaxpayerData, TaxpayerFieldOrigin>> = {
    detail: 'ECHO',
    taxId: 'ECHO',
    taxIdType: 'ECHO',
    providerMetadata: 'DIAGNOSTIC',
    personType: 'IDENTITY',
    name: 'IDENTITY',
    firstName: 'IDENTITY',
    lastName: 'IDENTITY',
    registrationStatus: 'IDENTITY',
    documentType: 'IDENTITY',
    documentNumber: 'IDENTITY',
    birthDate: 'IDENTITY',
    registrationDate: 'IDENTITY',
    legalForm: 'IDENTITY',
    incorporationDate: 'IDENTITY',
    fiscalYearEndMonth: 'IDENTITY',
    fiscalAddress: 'IDENTITY',
    addresses: 'IDENTITY',
    activities: 'SITUATION',
    taxes: 'SITUATION',
    simplifiedRegimeCategory: 'SITUATION',
};

/**
 * Whether a parsed value carries anything at all.
 *
 * Recursive because the padrón's *containers* can arrive empty: an `<domicilioFiscal/>` element parses into
 * a {@link PadronAddress} whose every field is `undefined`, and the constancia service copies that same
 * address into `addresses`, so a presence-only check would read two populated members out of a response
 * that stated nothing. Blank strings are already `undefined` by the time they reach here ({@link text}),
 * and re-checked anyway so this holds for any value rather than only for one this module produced.
 */
function reportsSomething(value: unknown): boolean {
    if (value === undefined || value === null) {
        return false;
    }
    if (typeof value === 'string') {
        return value.trim() !== '';
    }
    if (Array.isArray(value)) {
        return value.some(reportsSomething);
    }
    if (typeof value === 'object') {
        return Object.values(value).some(reportsSomething);
    }
    return true;
}

/**
 * Whether a padrón answer names nobody — every `IDENTITY` member absent or empty, whatever the echoes,
 * diagnostics and registered taxes beside them say. One populated member of that group makes it a real
 * answer.
 *
 * This is what tells a taxpayer the authority described from a container it sent with nothing in it. A
 * record with no name, no person type, no registration status and no address carries nothing a caller can
 * read the taxpayer out of: it is indistinguishable from a miss on every axis anyone consumes, and
 * returning it as a success is how an empty draft reached the customer form and was auto-applied as if it
 * were data.
 *
 * `SITUATION` members deliberately do NOT rescue such a record. A tax or an activity with no one attached
 * to it cannot be shown to a customer, and the asymmetry decides the doubtful case: a wrong miss costs one
 * A13 round trip, where a wrong answer is the bug above. A response that really does hold a registration
 * carries `estadoClave` — and with it `registrationStatus` — in every worked example in both manuals.
 *
 * Evaluated on the MAPPED record, never on the raw SOAP node. Key-counting `datosGenerales` measures
 * whether ARCA sent a container, not whether the container said anything — and the node can arrive present
 * carrying only an `idPersona` echo.
 */
export function identifiesNoTaxpayer(data: TaxpayerData): boolean {
    return Object.entries(TAXPAYER_FIELD_ORIGIN).every(
        ([field, origin]) => origin !== 'IDENTITY' || !reportsSomething(data[field as keyof TaxpayerData]),
    );
}

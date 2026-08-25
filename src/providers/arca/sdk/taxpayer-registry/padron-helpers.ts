// ---- Padrón wire helpers ----

import type {PadronAddress, PersonType, RegistrationStatus} from './padron.types.js';

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

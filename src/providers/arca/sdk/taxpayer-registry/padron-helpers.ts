import type {PadronAddress, PersonType, RegistrationStatus, TaxpayerData} from './padron.types.js';
import {hasAnyContent, text} from '../../../xml-node/xml-node.js';

/**
 * The SOAP parser runs with `parseTagValue: false`, so every padrón field arrives as a string and an empty
 * element reads as `''`. These helpers turn that raw shape into the SDK types, treating blank as "not
 * returned" rather than as a value.
 */

/**
 * An ISO-8601 calendar date from either padrón spelling: A13's XSD `dateTime`
 * (`1936-02-11T12:00:00-03:00`) or the compact `YYYYMMDD` the caracterizaciones use. The date part is taken
 * verbatim rather than parsed — these are ARCA calendar dates, and running them through UTC could shift the
 * day.
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
 * An ISO-8601 year-month from ARCA's `AAAAMM` period. Some elements carry a full `AAAAMMDD`, which is
 * truncated. A value in neither shape is returned as-is rather than dropped: the period is informational.
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
 * `ACTIVO` → `ACTIVE`, anything else ARCA reports → `INACTIVE`. Only a missing `estadoClave` is left
 * unreported: "not active" is the safe reading of every non-`ACTIVO` state.
 */
export function registrationStatus(value: unknown): RegistrationStatus | undefined {
    const s = text(value)?.toUpperCase();
    if (s === undefined) {
        return undefined;
    }
    return s === 'ACTIVO' ? 'ACTIVE' : 'INACTIVE';
}

/** Maps one ARCA `domicilio`/`domicilioFiscal` element to an address. */
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

/**
 * How a taxpayer record's member relates to what the authority actually told us about the person asked about.
 *
 * - `ECHO` — the request handed back, or which service answered. `taxId` is the number the caller asked
 *   with, `taxIdType` is derivable from it, and `detail` names the padrón that replied. None is evidence
 *   that a padrón holds this taxpayer, and they are why an empty answer looks almost populated.
 * - `DIAGNOSTIC` — `providerMetadata`, which carries `errorConstancia` and is therefore populated precisely
 *   when the constancia declined to report a clave.
 * - `SITUATION` — what the taxpayer is registered for. Real authority content, but it names nobody: a
 *   cancelled clave can come back with an empty `datosGenerales` and a dangling `impuesto` beside it.
 * - `IDENTITY` — who the taxpayer is and what state their clave is in. The only group a caller can read the
 *   taxpayer out of, so one populated member here is what makes a response an answer.
 */
type TaxpayerFieldOrigin = 'ECHO' | 'DIAGNOSTIC' | 'SITUATION' | 'IDENTITY';

/**
 * Every member of the taxpayer record, classified. Exhaustive by type rather than a list of the fields that
 * count, so a member added to the interface fails to compile until classified — the only thing stopping
 * `identifiesNoTaxpayer` from silently weakening as the shape grows.
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
 * Whether a padrón answer names nobody — every `IDENTITY` member absent or empty, whatever the echoes,
 * diagnostics and registered taxes beside them say.
 *
 * A record with no name, no person type, no registration status and no address is indistinguishable from a
 * miss on every axis anyone consumes, and returning it as a success is how an empty draft reached the
 * customer form and was auto-applied as if it were data.
 *
 * `SITUATION` members do not rescue such a record: a tax with nobody attached cannot be shown to a customer,
 * and the asymmetry decides the doubtful case — a wrong miss costs one A13 round trip where a wrong answer
 * is the bug above. A response that really holds a registration carries `estadoClave` in every worked
 * example in both manuals.
 *
 * Evaluated on the mapped record, never the raw SOAP node: key-counting `datosGenerales` measures whether
 * ARCA sent a container rather than whether it said anything, and the node can arrive carrying only an
 * `idPersona` echo.
 */
export function identifiesNoTaxpayer(data: TaxpayerData): boolean {
    return Object.entries(TAXPAYER_FIELD_ORIGIN).every(
        ([field, origin]) => origin !== 'IDENTITY' || !hasAnyContent(data[field as keyof TaxpayerData]),
    );
}

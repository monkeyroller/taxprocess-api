import {TaxpayerRegistryService} from './taxpayer-registry.service.base.js';
import {ENDPOINTS, Namespaces, ServiceId} from '../core/constants.js';
import {ArcaTaxpayerNotFoundError} from '../core/errors.js';
import {firstOf} from '../invoicing/common/common-helpers.js';
import {
    address,
    asArray,
    fiscalAddressOf,
    integer,
    isoDate,
    isoPeriod,
    personType,
    registrationStatus,
    text,
} from './padron-helpers.js';
import type {ArcaAuth} from '../core/types.js';
import type {PadronActivity, PadronService, TaxpayerData} from './padron.types.js';

/**
 * Consulta a Padrón — Alcance 13 (`ws_sr_padron_a13`), the *identity* half of the padrón: names,
 * identity document, birth date, legal form, every declared address, and the principal activity. It
 * reports no registered taxes and no monotributo data — that is the constancia service's half.
 *
 * Two operations are used:
 * - `getPersonaV2` (no underscore, unlike the constancia service's `getPersona_v2`) — manual v1.4 §3.4.
 *   It answers even when the clave is INACTIVA, which the v1 `getPersona` refuses; an inactive taxpayer
 *   must come back as data with `registrationStatus: 'INACTIVE'`, not as an error.
 * - `getIdPersonaListByDocumento` — resolves an identity document number to the claves issued for it.
 *   One document commonly maps to several (a person's CUIL and CUIT), so it returns a list.
 */
export class TaxpayerIdentityService extends TaxpayerRegistryService {
    protected readonly padron: PadronService = 'A13';
    protected readonly serviceId = ServiceId.PADRON_A13;
    protected readonly namespace = Namespaces.PADRON_A13;
    protected readonly operation = 'getPersonaV2';

    protected endpoint(): string {
        return ENDPOINTS[this.environment].padronA13;
    }

    /**
     * Claves registered against an identity document number, in ARCA's order. An unknown document is an
     * empty list, not an error — the caller decides whether "no match" is a 404.
     */
    async getIdPersonaList(auth: ArcaAuth, documentNumber: number): Promise<Array<string>> {
        const response = await this.invoke(
            'getIdPersonaListByDocumento',
            {
                token: auth.token,
                sign: auth.sign,
                cuitRepresentada: auth.cuit,
                documento: documentNumber,
            },
            documentNumber,
        );
        const list = firstOf(response.idPersonaListReturn) ?? {};
        return asArray(list.idPersona)
            .map((id) => text(id))
            .filter((id): id is string => id !== undefined);
    }

    protected override parseTaxpayer(result: Record<string, unknown>, taxpayerId: number): TaxpayerData {
        const persona = firstOf(firstOf(result.personaReturn)?.persona);
        if (persona === undefined) {
            // A 200 with no `persona` block is A13's silent form of "no such clave".
            throw new ArcaTaxpayerNotFoundError(String(taxpayerId));
        }

        const addresses = asArray(persona.domicilio).map(address);
        const legalName = text(persona.razonSocial);
        const firstName = text(persona.nombre);
        const lastName = text(persona.apellido);

        return {
            detail: 'IDENTITY',
            taxId: text(persona.idPersona) ?? String(taxpayerId),
            taxIdType: text(persona.tipoClave),
            personType: personType(persona.tipoPersona),
            name: legalName ?? text([lastName, firstName].filter((part) => part !== undefined).join(' ')),
            firstName,
            lastName,
            registrationStatus: registrationStatus(persona.estadoClave),
            documentType: text(persona.tipoDocumento),
            documentNumber: text(persona.numeroDocumento),
            birthDate: isoDate(persona.fechaNacimiento),
            registrationDate: isoDate(persona.fechaInscripcion),
            legalForm: text(persona.formaJuridica),
            incorporationDate: isoDate(persona.fechaContratoSocial),
            fiscalYearEndMonth: integer(persona.mesCierre),
            fiscalAddress: fiscalAddressOf(addresses),
            addresses,
            activities: parsePrincipalActivity(persona),
            // No `taxes` key at all: this service cannot report them, and an empty array would read as
            // "none registered" (see the per-detail table in docs/CONTRACT.md).
            providerMetadata: buildMetadata(persona),
        };
    }
}

/**
 * A13 reports a single principal activity as three flat fields rather than a list. It is surfaced as a
 * one-entry `activities` array so both padrón details expose activities the same way.
 */
function parsePrincipalActivity(persona: Record<string, any>): Array<PadronActivity> {
    const code = text(persona.idActividadPrincipal);
    if (code === undefined) {
        return [];
    }
    return [
        {
            code,
            description: text(persona.descripcionActividadPrincipal),
            period: isoPeriod(persona.periodoActividadPrincipal),
            primary: true,
        },
    ];
}

/** ARCA-only identity extras with no cross-country meaning. */
function buildMetadata(persona: Record<string, any>): Record<string, unknown> {
    const metadata: Record<string, unknown> = {service: ServiceId.PADRON_A13};

    const deceasedDate = isoDate(persona.fechaFallecimiento);
    if (deceasedDate !== undefined) {
        metadata.deceasedDate = deceasedDate;
    }
    const dependencia = firstOf(persona.dependencia);
    if (dependencia !== undefined) {
        metadata.dependencia = {
            code: text(dependencia.idDependencia),
            description: text(dependencia.descripcionDependencia),
        };
    }
    return metadata;
}

import {TaxpayerRegistryService} from './taxpayer-registry.service.base.js';
import {ENDPOINTS, Namespaces, ServiceId} from '../core/constants.js';
import {ArcaTaxpayerNotFoundError} from '../core/errors.js';
import {asArray, firstOf, integer, text} from '../../../xml-node/xml-node.js';
import {
    address,
    fiscalAddressOf,
    identifiesNoTaxpayer,
    isoDate,
    isoPeriod,
    personType,
    registrationStatus,
} from './padron-helpers.js';
import type {ArcaAuth} from '../core/types.js';
import type {PadronActivity, PadronService, TaxpayerData} from './padron.types.js';

/**
 * Consulta a Padrón — Alcance 13, the identity half of the padrón: names, identity document, birth date,
 * legal form, every declared address, and the principal activity. No registered taxes and no monotributo
 * data — that is the constancia service's half.
 *
 * Two operations. `getPersonaV2` (no underscore, unlike the constancia service's spelling) answers even for
 * an inactive clave, which the v1 `getPersona` refuses: an inactive taxpayer must come back as data rather
 * than an error. `getIdPersonaListByDocumento` resolves an identity document to the claves issued for it,
 * commonly several, so it returns a list.
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
        const persona = firstOf(firstOf(result.personaReturn)?.persona) ?? {};

        const addresses = asArray(persona.domicilio).map(address);
        const legalName = text(persona.razonSocial);
        const firstName = text(persona.nombre);
        const lastName = text(persona.apellido);

        const data: TaxpayerData = {
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
            // "none registered".
            providerMetadata: buildMetadata(persona),
        };

        // A `200` that names no taxpayer is A13's silent form of "no such clave", in several spellings: no
        // `persona` block, an empty container, or one carrying nothing but the `idPersona` asked with. All
        // three produce the empty draft the customer form auto-applies, and testing that the container was
        // merely present caught only the first — so the same shape test the constancia uses decides it here.
        //
        // A13 has no fallback behind it, so this miss is the authoritative `404`. That is the right reading
        // regardless: a populated persona block carries `estadoClave` and the names in every manual example,
        // and a record with none of them says nothing a caller could act on.
        if (identifiesNoTaxpayer(data)) {
            throw new ArcaTaxpayerNotFoundError(String(taxpayerId));
        }

        return data;
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

import {TaxpayerRegistryService} from './taxpayer-registry.service.base.js';
import {ENDPOINTS, Namespaces, ServiceId} from '../core/constants.js';
import {ArcaTaxpayerNotFoundError} from '../core/errors.js';
import {isTaxpayerMissing} from './padron-faults.js';
import {firstOf} from '../invoicing/common/common-helpers.js';
import {
    address,
    asArray,
    integer,
    isoDate,
    isoPeriod,
    personType,
    registrationStatus,
    text,
} from './padron-helpers.js';
import type {PadronActivity, PadronService, PadronTax, TaxpayerData} from './padron.types.js';

/**
 * Consulta a Padrón — Constancia de Inscripción (`ws_sr_constancia_inscripcion`), the service ARCA's
 * catalog names as the replacement for the deprecated alcance 5 (`ws_sr_padron_a5`). The rename did not
 * move the endpoint or the namespace — both are still the alcance-5 ones — but the WSAA ticket must be
 * requested under the new id, and the certificate enrolled under it.
 *
 * Returns the taxpayer's registration picture: fiscal address, registered taxes, activities, régimen
 * general / monotributo data. It carries no identity document and no birth date — that is A13's half
 * (see `taxpayer-identity.service.ts`), which is why the SDK reports a `PadronDetail` alongside the data.
 *
 * Uses `getPersona_v2` (manual v4.1 §3.2): it returns every monotributo activity and the caracterizaciones
 * the v1 operation omits.
 */
export class ConstanciaInscripcionService extends TaxpayerRegistryService {
    protected readonly padron: PadronService = 'CONSTANCIA';
    protected readonly serviceId = ServiceId.CONSTANCIA_INSCRIPCION;
    protected readonly namespace = Namespaces.CONSTANCIA;
    protected readonly operation = 'getPersona_v2';

    protected endpoint(): string {
        return ENDPOINTS[this.environment].constanciaInscripcion;
    }

    protected override parseTaxpayer(result: Record<string, unknown>, taxpayerId: number): TaxpayerData {
        const persona = firstOf(result.personaReturn) ?? {};
        const errors = asArray(persona.errorConstancia).flatMap((e) => asArray(e.error).map(String));
        // `errorConstancia` doubles as the not-found channel AND as a list of data-quality complaints about
        // an existing taxpayer (manual §5.3: "Domicilio Incompleto", "Nombre erróneo", …). Only a complaint
        // about the PERSON is a 404 — one about a missing address would otherwise throw away a complete
        // registration. The rest ride along as metadata on an otherwise normal result.
        const missing = errors.find(isTaxpayerMissing);
        if (missing !== undefined) {
            throw new ArcaTaxpayerNotFoundError(String(taxpayerId), missing);
        }

        const general = firstOf(persona.datosGenerales) ?? {};
        const regimeGeneral = firstOf(persona.datosRegimenGeneral) ?? {};
        const monotributo = firstOf(persona.datosMonotributo) ?? {};

        const fiscalAddressNode = firstOf(general.domicilioFiscal);
        const fiscalAddress = fiscalAddressNode === undefined ? undefined : address(fiscalAddressNode);

        const legalName = text(general.razonSocial);
        const firstName = text(general.nombre);
        const lastName = text(general.apellido);

        const category = currentCategory(monotributo);

        return {
            detail: 'REGISTRATION',
            // `datosGenerales.idPersona` is optional in the schema; fall back to the clave we asked about.
            taxId: text(general.idPersona) ?? String(taxpayerId),
            taxIdType: text(general.tipoClave),
            personType: personType(general.tipoPersona),
            name: legalName ?? text([lastName, firstName].filter((part) => part !== undefined).join(' ')),
            firstName,
            lastName,
            registrationStatus: registrationStatus(general.estadoClave),
            incorporationDate: isoDate(general.fechaContratoSocial),
            fiscalYearEndMonth: integer(general.mesCierre),
            fiscalAddress,
            // This service reports only the fiscal address, so the list is that one entry (or empty).
            addresses: fiscalAddress === undefined ? [] : [fiscalAddress],
            activities: parseActivities(regimeGeneral, monotributo),
            taxes: parseTaxes(regimeGeneral, monotributo),
            simplifiedRegimeCategory: text(category?.descripcionCategoria) ?? text(category?.idCategoria),
            providerMetadata: buildMetadata(general, regimeGeneral, persona, errors),
        };
    }
}

/**
 * The taxpayer's CURRENT small-taxpayer category. ARCA returns one `categoriaMonotributo` per period the
 * taxpayer has held — recategorización is twice-yearly — and documents no ordering, so the latest `periodo`
 * wins rather than whichever element happened to come first. Comparing the ISO-normalized year-month keeps
 * that safe when ARCA sends a full `AAAAMMDD` in the same list as an `AAAAMM`, which raw string or numeric
 * comparison would order wrongly.
 */
function currentCategory(monotributo: Record<string, any>): Record<string, any> | undefined {
    const categories = asArray(monotributo.categoriaMonotributo);
    if (categories.length === 0) {
        return undefined;
    }
    return categories.reduce((latest, candidate) =>
        (isoPeriod(candidate.periodo) ?? '') > (isoPeriod(latest.periodo) ?? '') ? candidate : latest,
    );
}

/**
 * Every activity the taxpayer has, from both régimen general and monotributo. ARCA can list the same
 * activity under both blocks, so entries are de-duplicated by `idActividad` (first wins — régimen general
 * is read first and carries `orden`, from which `primary` is derived).
 */
function parseActivities(
    regimeGeneral: Record<string, any>,
    monotributo: Record<string, any>,
): Array<PadronActivity> {
    const nodes = [
        ...asArray(regimeGeneral.actividad),
        ...asArray(monotributo.actividad),
        ...asArray(monotributo.actividadMonotributista),
    ];
    const byCode = new Map<string, PadronActivity>();
    for (const node of nodes) {
        const code = text(node.idActividad);
        if (code === undefined || byCode.has(code)) {
            continue;
        }
        const order = integer(node.orden);
        byCode.set(code, {
            code,
            description: text(node.descripcionActividad),
            period: isoPeriod(node.periodo),
            // Left unreported when ARCA sends no `orden`, rather than asserting `false`. `primary` is
            // optional precisely so "not the principal activity" and "the authority did not say" stay
            // distinguishable — collapsing them would have every activity of a taxpayer whose block omits
            // `orden` claim it is not the principal one, which is a statement ARCA never made.
            primary: order === undefined ? undefined : order === 1,
        });
    }
    return [...byCode.values()];
}

/** Registered taxes from both blocks, de-duplicated by `idImpuesto` (régimen general first). */
function parseTaxes(regimeGeneral: Record<string, any>, monotributo: Record<string, any>): Array<PadronTax> {
    const nodes = [...asArray(regimeGeneral.impuesto), ...asArray(monotributo.impuesto)];
    const byCode = new Map<string, PadronTax>();
    for (const node of nodes) {
        const code = text(node.idImpuesto);
        if (code === undefined || byCode.has(code)) {
            continue;
        }
        byCode.set(code, {
            code,
            description: text(node.descripcionImpuesto),
            period: isoPeriod(node.periodo),
            status: text(node.estadoImpuesto),
            reason: text(node.motivo),
        });
    }
    return [...byCode.values()];
}

/**
 * ARCA-only data with no cross-country meaning, passed through for callers that need it: caracterizaciones
 * (which since 2026 carry flags such as `GANANCIAS SIMPLIFICADA LEY 27.779`), the sucesión/fallecimiento
 * markers, the taxpayer's dependencia, régimen and autónomos entries, and the per-block constancia errors.
 * Keys are added only when present, so an unremarkable taxpayer yields just the `service` marker.
 */
function buildMetadata(
    general: Record<string, any>,
    regimeGeneral: Record<string, any>,
    persona: Record<string, any>,
    errors: ReadonlyArray<string>,
): Record<string, unknown> {
    const metadata: Record<string, unknown> = {service: ServiceId.CONSTANCIA_INSCRIPCION};

    const caracterizaciones = asArray(general.caracterizacion).map((c) => ({
        code: text(c.idCaracterizacion),
        description: text(c.descripcionCaracterizacion),
        requestedDate: isoDate(c.fechaSolicitud),
        period: isoPeriod(c.periodo),
    }));
    if (caracterizaciones.length > 0) {
        metadata.caracterizaciones = caracterizaciones;
    }

    const regimenes = asArray(regimeGeneral.regimen).map((r) => ({
        code: text(r.idRegimen),
        description: text(r.descripcionRegimen),
        taxCode: text(r.idImpuesto),
        kind: text(r.tipoRegimen),
        period: isoPeriod(r.periodo),
    }));
    if (regimenes.length > 0) {
        metadata.regimenes = regimenes;
    }

    const autonomos = asArray(regimeGeneral.categoriaAutonomo).map((c) => ({
        code: text(c.idCategoria),
        description: text(c.descripcionCategoria),
        period: isoPeriod(c.periodo),
    }));
    if (autonomos.length > 0) {
        metadata.categoriasAutonomo = autonomos;
    }

    const dependencia = firstOf(general.dependencia);
    if (dependencia !== undefined) {
        metadata.dependencia = {
            code: text(dependencia.idDependencia),
            description: text(dependencia.descripcionDependencia),
        };
    }

    const esSucesion = text(general.esSucesion);
    if (esSucesion !== undefined) {
        metadata.esSucesion = esSucesion.toUpperCase() === 'SI';
    }
    const deceasedDate = isoDate(general.fechaFallecimiento);
    if (deceasedDate !== undefined) {
        metadata.deceasedDate = deceasedDate;
    }

    if (errors.length > 0) {
        metadata.constanciaErrors = [...errors];
    }
    const regimeErrors = asArray(persona.errorRegimenGeneral).flatMap((e) => asArray(e.error).map(String));
    if (regimeErrors.length > 0) {
        metadata.regimenGeneralErrors = regimeErrors;
    }
    const monotributoErrors = asArray(persona.errorMonotributo).flatMap((e) => asArray(e.error).map(String));
    if (monotributoErrors.length > 0) {
        metadata.monotributoErrors = monotributoErrors;
    }

    return metadata;
}

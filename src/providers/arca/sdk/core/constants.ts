/**
 * ARCA SOAP endpoints and namespaces, split by environment.
 *
 * NOTE: the web-service HOSTNAMES below intentionally remain on `afip.gov.ar` — that is where ARCA
 * (ex-AFIP) physically runs the SOAP services; the `arca.gov.ar` equivalents do not resolve. Like
 * the SOAP namespaces, these are ARCA's actual server addresses, not app naming. This is the single
 * place to switch hosts — if a call unexpectedly returns 404, verify against the live WSDL
 * (`<endpoint>?WSDL`) and update it here. Nothing else in the SDK hardcodes a URL.
 *
 * Re-verified 2026-08-21 against the padrón manuals: the constancia manual v4.1 rewrote its documented
 * URLs from `afip.gov.ar` to `arca.gob.ar`, but `awshomo.arca.gob.ar` does not resolve at all, while
 * `awshomo.afip.gov.ar` (testing) and `aws.arca.gob.ar` (production) both answer. The A13 manual v1.4
 * still documents `afip.gov.ar` for both environments. So the `afip.gov.ar` spellings below stay —
 * do NOT "modernize" them to match the constancia manual.
 */

export type ArcaEnvironment = 'homologacion' | 'produccion';

/**
 * ARCA service identifiers used to request a per-service WSAA access ticket.
 *
 * `CONSTANCIA_INSCRIPCION` is the padrón service formerly registered as `ws_sr_padron_a5`: ARCA renamed
 * it and marks the old alcance-5 id as deprecated in its service catalog. The endpoint and namespace are
 * unchanged by the rename (still `personaServiceA5` / `a5.soap.ws.server.puc.sr`) — only the WSAA service
 * id moved, and the certificate must be enrolled under the NEW id.
 */
export const ServiceId = {
    WSFEV1: 'wsfe',
    WSFEXV1: 'wsfex',
    CONSTANCIA_INSCRIPCION: 'ws_sr_constancia_inscripcion',
    PADRON_A13: 'ws_sr_padron_a13',
} as const;

export type ServiceIdValue = (typeof ServiceId)[keyof typeof ServiceId];

/** SOAP target namespaces per web service (also used to compose the SOAPAction header). */
export const Namespaces = {
    WSAA: 'http://wsaa.view.sua.dvadac.desein.afip.gov',
    WSFEV1: 'http://ar.gov.afip.dif.FEV1/',
    WSFEXV1: 'http://ar.gov.afip.dif.fexv1/',
    /** Constancia de inscripción — still the alcance-5 namespace after the service rename. */
    CONSTANCIA: 'http://a5.soap.ws.server.puc.sr/',
    PADRON_A13: 'http://a13.soap.ws.server.puc.sr/',
} as const;

export interface ServiceEndpoints {
    readonly wsaa: string;
    readonly wsfev1: string;
    readonly wsfexv1: string;
    /** Constancia de inscripción — still the `personaServiceA5` path after the service rename. */
    readonly constanciaInscripcion: string;
    readonly padronA13: string;
}

export const ENDPOINTS: Record<ArcaEnvironment, ServiceEndpoints> = {
    homologacion: {
        wsaa: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
        wsfev1: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
        wsfexv1: 'https://wswhomo.afip.gov.ar/wsfexv1/service.asmx',
        constanciaInscripcion: 'https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA5',
        padronA13: 'https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA13',
    },
    produccion: {
        wsaa: 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
        wsfev1: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
        wsfexv1: 'https://servicios1.afip.gov.ar/wsfexv1/service.asmx',
        constanciaInscripcion: 'https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA5',
        padronA13: 'https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA13',
    },
};

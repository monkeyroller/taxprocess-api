/**
 * ARCA SOAP endpoints and namespaces, split by environment. The single place to switch hosts; nothing else
 * in the SDK hardcodes a URL, so verify an unexpected 404 against the live WSDL and update it here.
 *
 * The hostnames stay on `afip.gov.ar`, which is where ARCA physically runs the SOAP services. Verified
 * 2026-08-21: the constancia manual v4.1 rewrote its documented URLs to `arca.gob.ar`, but
 * `awshomo.arca.gob.ar` does not resolve while `awshomo.afip.gov.ar` answers, and the A13 manual still
 * documents `afip.gov.ar` for both environments. Do not modernize these to match the constancia manual.
 */

export type ArcaEnvironment = 'homologacion' | 'produccion';

/**
 * ARCA service identifiers used to request a per-service WSAA access ticket.
 *
 * `CONSTANCIA_INSCRIPCION` is the padrón service formerly registered as `ws_sr_padron_a5`, which ARCA now
 * marks deprecated. The rename moved only the WSAA service id, leaving the endpoint and namespace on their
 * alcance-5 spellings, and the certificate must be enrolled under the new id.
 */
export const ServiceId = {
    WSFEV1: 'wsfe',
    WSFEXV1: 'wsfex',
    CONSTANCIA_INSCRIPCION: 'ws_sr_constancia_inscripcion',
    PADRON_A13: 'ws_sr_padron_a13',
    /**
     * WSFECRED — the Factura de Crédito Electrónica registry. Only the reception-obligation query is used;
     * the acceptance lifecycle lives here too and is deliberately out of scope.
     *
     * Enrolment is independent of `wsfe`, so a certificate that authorizes vouchers will still fail this
     * login with `coe.notAuthorized` until it is granted separately.
     */
    WSFECRED: 'wsfecred',
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
    /** WSFECRED. Read from the live WSDL 2026-09-17; note it is `gob`, unlike the two above. */
    WSFECRED: 'http://ar.gob.afip.wsfecred/FECredService/',
} as const;

export interface ServiceEndpoints {
    readonly wsaa: string;
    readonly wsfev1: string;
    readonly wsfexv1: string;
    /** Constancia de inscripción — still the `personaServiceA5` path after the service rename. */
    readonly constanciaInscripcion: string;
    readonly padronA13: string;
    /**
     * WSFECRED. Required rather than optional so a URL supplied for one environment only is a compile
     * error here, not a 404 that surfaces the first time production asks.
     */
    readonly wsfecred: string;
}

export const ENDPOINTS: Record<ArcaEnvironment, ServiceEndpoints> = {
    homologacion: {
        wsaa: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
        wsfev1: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
        wsfexv1: 'https://wswhomo.afip.gov.ar/wsfexv1/service.asmx',
        constanciaInscripcion: 'https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA5',
        padronA13: 'https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA13',
        wsfecred: 'https://fwshomo.afip.gov.ar/wsfecred/FECredService',
    },
    produccion: {
        wsaa: 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
        wsfev1: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
        wsfexv1: 'https://servicios1.afip.gov.ar/wsfexv1/service.asmx',
        constanciaInscripcion: 'https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA5',
        padronA13: 'https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA13',
        // The one `gob.ar` host here, and a genuine exception to the note at the top of this file rather
        // than an oversight: WSFECRED is in the newer Java family and its own WSDL publishes this address
        // (read 2026-09-17). Homologación stays on `gov.ar`, so the two environments genuinely differ in
        // the TLD — do not "fix" either to match the other.
        wsfecred: 'https://serviciosjava.afip.gob.ar/wsfecred/FECredService',
    },
};

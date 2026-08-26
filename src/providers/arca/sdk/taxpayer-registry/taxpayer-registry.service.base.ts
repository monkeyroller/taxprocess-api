import {SoapClient} from '../core/soap-client.js';
import {NotImplementedError} from '../core/errors.js';
import {translatePadronFault} from './padron-faults.js';
import type {ArcaEnvironment, ServiceIdValue} from '../core/constants.js';
import type {ArcaAuth} from '../core/types.js';
import type {PadronService, TaxpayerData} from './padron.types.js';

/**
 * Shared base for the ARCA padrón "consulta de persona" web services.
 *
 * All of them take the same SOAP inputs — `(token, sign, cuitRepresentada, idPersona)` — and differ in
 * their operation name, their endpoint/namespace, and how much taxpayer data they return, which is why
 * they belong under one base parameterized by {@link PadronService}. The base owns the SOAP call; each
 * service fills its identity (`padron`, `serviceId`, `namespace`, `operation`, `endpoint`) and its
 * `parseTaxpayer`.
 *
 * Fault classification is the base's too, via {@link invoke} — the services share ARCA's `sr-padron` webapp
 * and therefore its fault vocabulary, so an unknown clave has to mean `404` whichever alcance was asked.
 *
 * Each service also requires its own enrolment of the calling certificate at ARCA and its own WSAA
 * ticket (keyed by `serviceId`).
 */
export abstract class TaxpayerRegistryService {
    /** Which padrón service this is, in SDK vocabulary. */
    protected abstract readonly padron: PadronService;
    /** ARCA service id, e.g. `"ws_sr_constancia_inscripcion"` — the WSAA ticket key. */
    protected abstract readonly serviceId: ServiceIdValue;
    protected abstract readonly namespace: string;
    /**
     * SOAP operation name. Deliberately per-service: the two live services spell their v2 lookup
     * differently (`getPersona_v2` for constancia, `getPersonaV2` for A13), and the v1 `getPersona` both
     * still expose is the one to avoid — it refuses to answer for an INACTIVA key.
     */
    protected abstract readonly operation: string;

    constructor(
        protected readonly soap: SoapClient,
        protected readonly environment: ArcaEnvironment,
    ) {}

    protected abstract endpoint(): string;

    /** ARCA service id this instance authenticates against — used to request the WSAA ticket. */
    get service(): ServiceIdValue {
        return this.serviceId;
    }

    /**
     * Sends one padrón SOAP operation, translating the authority's documented fault conditions into the SDK's
     * own errors ({@link translatePadronFault}). Every padrón operation goes through here, including the
     * subclass-specific ones, so no service can accidentally return a `502` for a condition its sibling
     * reports as a `404`.
     *
     * `subject` is the identifier the call is about, echoed into a not-found so the error names what was asked
     * for even when the authority's own wording does not.
     *
     * The padrón services are JAX-WS and expect UNQUALIFIED children (`<token>`, not
     * `{a5.soap.ws.server.puc.sr}token`) — unlike the .NET invoicing services, which take the SDK's default
     * qualified form. Getting this wrong is rejected at unmarshalling, before the ticket is read, so it
     * surfaces as an auth-looking fault; see {@link ElementForm}.
     */
    protected async invoke(
        operation: string,
        payload: Record<string, unknown>,
        subject: number,
    ): Promise<Record<string, unknown>> {
        try {
            return await this.soap.call(this.endpoint(), this.namespace, operation, payload, {
                elementForm: 'unqualified',
            });
        } catch (err) {
            throw translatePadronFault(err, String(subject));
        }
    }

    /**
     * Looks up one taxpayer by their clave (CUIT/CUIL/CDI). `taxpayerId` is echoed into the parsed
     * result so `taxId` is always populated even when the service omits `idPersona`.
     */
    async getTaxpayer(auth: ArcaAuth, taxpayerId: number): Promise<TaxpayerData> {
        const response = await this.invoke(
            this.operation,
            {
                token: auth.token,
                sign: auth.sign,
                cuitRepresentada: auth.cuit,
                idPersona: taxpayerId,
            },
            taxpayerId,
        );
        return this.parseTaxpayer(response, taxpayerId);
    }

    protected parseTaxpayer(_result: Record<string, unknown>, _taxpayerId: number): TaxpayerData {
        throw new NotImplementedError(`${this.constructor.name}.getTaxpayer`);
    }
}

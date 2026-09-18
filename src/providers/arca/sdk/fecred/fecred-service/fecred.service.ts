import {ENDPOINTS, Namespaces, ServiceId, type ArcaEnvironment, type ServiceIdValue} from '../../core/constants.js';
import {SoapClient, type ElementForm} from '../../core/soap-client/soap-client.js';
import {ArcaServiceError} from '../../core/errors.js';
import {asArray, decimal, firstOf, text, type XmlNode} from '../../../../xml-node/xml-node.js';
import type {ArcaAuth} from '../../core/types.js';
import type {ReceptionObligationInfo, ReceptionObligationQuery} from '../fecred.types.js';

/**
 * WSFECRED — ARCA's Factura de Crédito Electrónica registry. One operation is modelled: the query asking
 * whether a receiver must be sent an FCE, and from what amount.
 *
 * Its own service rather than a mode of the invoicing one, for the reason `fexInvoiceService` states: it
 * authenticates against a separate WSAA scope (`wsfecred`), needing its own certificate enrolment, so a
 * certificate good for `wsfe` will fail this login with `coe.notAuthorized` until it is granted separately.
 *
 * No base class. `InvoiceWebService` is a fixed operation vocabulary — authorize, lastAuthorized, query,
 * pointsOfSale, currencyRate, currencyTypes, dummy — and a subclass here would declare seven empty
 * operation names and inherit seven hooks that throw. This is structurally `TaxpayerRegistryService`'s
 * shape (declared service id, namespace, endpoint, one `invoke`) without inheriting a padrón fault
 * vocabulary it does not share.
 *
 * ## The wire is read from the WSDL, not guessed
 *
 * Everything below was taken from `<endpoint>?wsdl` on 2026-09-17, both environments. The WSDL is public
 * and needs no certificate, which makes it the cheapest correction path for anything here that drifts:
 * re-read it before reaching for a probe. What it fixes, per its own declarations:
 *
 * - `style="document" use="literal"`, and the schema declares no `elementFormDefault`, so children are
 *   **unqualified** — the JAX-WS shape, not the `.asmx` services' qualified one.
 * - The operation binds to an input element named `consultarMontoObligadoRecepcion**Request**` while the
 *   output stays `…Response`. That asymmetry is why {@link SoapCallOptions.requestElement} exists; the
 *   response lookup stays on the bare operation name.
 *
 *   The `…Return` wrapper *inside* that response is the one name here not taken from the WSDL — it is the
 *   JAX-WS convention, shared with the padrón services. {@link parseReceptionObligation} therefore reads it
 *   first and falls back to the response root, and records what that costs if both are wrong.
 * - The binding declares `soapAction="consultarMontoObligadoRecepcion"` — the **bare operation**, not a
 *   URI. `SoapClient`'s default would send `{namespace}/{operation}`, which is right for the `.asmx`
 *   services and wrong here, so {@link invoke} passes `soapAction` explicitly. `wsaa-client.ts` overrides
 *   the same option with `''` for the same kind of reason. A wrong `SOAPAction` and a wrong element form
 *   fail the same indistinguishable way, so both are asserted in this service's tests rather than left to
 *   be rediscovered from a fault.
 * - `authRequest` is `{token, sign, cuitRepresentada}`, `cuitRepresentada` being an `xsd:long`.
 * - `fechaEmision` is an `xsd:date`, so `YYYY-MM-DD` — not ARCA's `yyyymmdd`.
 * - `obligado` and `montoDesde` are both `minOccurs="0"`. The authority itself says they may be absent,
 *   which is why {@link ReceptionObligationInfo} types them as optional rather than defaulting them.
 * - Errors arrive **in-payload** as `arrayErrores`, like the `.asmx` services and unlike the padrón ones.
 */
export class FeCredService {
    protected readonly serviceId: ServiceIdValue = ServiceId.WSFECRED;
    protected readonly namespace: string = Namespaces.WSFECRED;

    /** Unqualified, per the WSDL schema's (absent, therefore default) `elementFormDefault`. */
    protected readonly elementForm: ElementForm = 'unqualified';

    /** The `wsdl:operation` name, which the binding also uses verbatim as the SOAPAction. */
    protected readonly operation: string = 'consultarMontoObligadoRecepcion';

    constructor(
        protected readonly soap: SoapClient,
        protected readonly environment: ArcaEnvironment,
    ) {}

    protected endpoint(): string {
        return ENDPOINTS[this.environment].wsfecred;
    }

    /** ARCA service id this instance authenticates against — the ticket store is keyed on it. */
    get service(): ServiceIdValue {
        return this.serviceId;
    }

    /** `AuthRequestType`: the three fields every WSFECRED operation opens with. */
    protected buildAuth(auth: ArcaAuth): Record<string, unknown> {
        return {
            authRequest: {
                token: auth.token,
                sign: auth.sign,
                cuitRepresentada: auth.cuit,
            },
        };
    }

    /**
     * Asks whether `query.receiverTaxId` is obligated to receive an FCE on `query.issueDate`, and from what
     * amount.
     *
     * Both facts come back from the same call because ARCA returns them together, and they must stay
     * together: a live `obligado` beside a threshold from anywhere else disagrees precisely when the régimen
     * changes, which is the only moment the answer matters.
     *
     * The request carries no economic activity because the schema permits none — the service resolves the
     * receiver's principal activity itself, which is what makes the tax id and the date sufficient.
     */
    async receptionObligation(
        auth: ArcaAuth,
        query: ReceptionObligationQuery,
    ): Promise<ReceptionObligationInfo> {
        const response = await this.invoke(this.operation, {
            ...this.buildAuth(auth),
            cuitConsultada: query.receiverTaxId,
            fechaEmision: query.issueDate,
        });
        return this.parseReceptionObligation(response);
    }

    /**
     * Sends one WSFECRED operation.
     *
     * Transport faults are left as `ArcaSoapError` rather than being classified here: what a WSFECRED
     * failure *means* is decided in `arca/faults/faults.ts`, which also records why this service has no
     * entry in the credential-fault dispatch table.
     */
    protected async invoke(
        operation: string,
        payload: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
        return this.soap.call(this.endpoint(), this.namespace, operation, payload, {
            elementForm: this.elementForm,
            requestElement: `${operation}Request`,
            // The bare operation, per the WSDL binding — not `SoapClient`'s `{namespace}/{operation}`
            // default, which is the `.asmx` convention and would be rejected here.
            soapAction: operation,
        });
    }

    /**
     * Reads `consultarMontoObligadoRecepcionReturn`, refusing the answer if the authority reported errors.
     *
     * The wrapper name is the JAX-WS convention rather than a WSDL reading, so the response root is used
     * when it is absent. Worth knowing what that cannot do: if the real wrapper is some third name,
     * `arrayErrores` is not found under the root either and a rejection parses as an answer with both
     * fields missing. `toAuthorityAnswer` refuses that rather than reading it as a verdict, so the outcome
     * is a labelled fallback and never a wrong `obligated` — but confirming this name against the schema's
     * output type would turn that fallback back into the error it should be.
     *
     * Values go through the `xml-node` helpers, which answer `undefined` for a missing or blank element.
     * That is the contract this whole endpoint rests on: an answer we cannot read must become a fallback,
     * never a confident verdict. So there is no `?? false` and no `|| 0` below, and there must not be — and
     * here that is the schema's own position too, both fields being `minOccurs="0"`.
     */
    protected parseReceptionObligation(response: Record<string, unknown>): ReceptionObligationInfo {
        const node = firstOf(response[`${this.operation}Return`]) ?? (response as XmlNode);
        this.assertNoErrors(node);
        return {
            obligated: readSiNo(node.obligado),
            thresholdAmount: decimal(node.montoDesde),
            raw: node,
        };
    }

    /**
     * Raises when the authority reported `arrayErrores`.
     *
     * In-payload rather than as a SOAP fault, which the WSDL settles: `arrayErrores` is declared inside the
     * return type, so a rejection arrives on a `200`. Left unread, it would parse as an answer with both
     * fields absent — indistinguishable from an unreadable response, and silently downgraded to the offline
     * registry instead of being reported.
     *
     * `arrayObservacion` is deliberately not read: an observación is the authority qualifying an answer it
     * still gave, and refusing one would turn a usable verdict into a fallback.
     */
    protected assertNoErrors(node: XmlNode): void {
        const errors = asArray(firstOf(node.arrayErrores)?.codigoDescripcion).map((entry) => ({
            code: text(entry.codigo) ?? '',
            message: text(entry.descripcion) ?? '',
        }));
        if (errors.length > 0) {
            throw new ArcaServiceError(
                `WSFECRED rejected the obligation query: ${errors.map((e) => `[${e.code}] ${e.message}`).join('; ')}`,
                errors,
            );
        }
    }
}

/**
 * `SiNoSimpleType` — the schema restricts this to exactly `"S"` or `"N"`, one character.
 *
 * The other spellings are accepted anyway, and **anything unrecognised reads as `undefined` rather than
 * `false`**. That asymmetry is the point: a value this does not know is a fact we failed to read, and the
 * honest rendering of that is absence, which the caller turns into a fallback. Rendering it as `false`
 * would say "this buyer is not obligated", and an ordinary factura issued to an obligated buyer is refused
 * by the authority later, off the numerator, with nothing naming the cause.
 */
function readSiNo(value: unknown): boolean | undefined {
    const raw = text(value);
    if (raw === undefined) {
        return undefined;
    }
    const normalized = raw.toUpperCase();
    if (normalized === 'S' || normalized === 'SI' || normalized === 'TRUE' || normalized === '1') {
        return true;
    }
    if (normalized === 'N' || normalized === 'NO' || normalized === 'FALSE' || normalized === '0') {
        return false;
    }
    return undefined;
}

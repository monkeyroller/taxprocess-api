import {XMLParser} from 'fast-xml-parser';
import {ArcaError, ArcaSoapError} from './errors.js';

/**
 * Minimal SOAP 1.1 client over native `fetch`. Deliberately avoids a WSDL/SOAP library: it builds
 * the envelope by hand and parses responses with `fast-xml-parser`, which keeps the dependency
 * surface tiny and the wire format fully explicit (important for a fiscal integration).
 *
 * Namespace prefixes are stripped on parse (`removeNSPrefix`) so `Envelope`/`Body` are reachable
 * regardless of whether the server answers with `soap:`, `soapenv:` or `S:`. Tag values are NOT
 * coerced to numbers (`parseTagValue: false`) so long fiscal identifiers (CUIT, 14-digit CAE) and
 * monetary strings are never mangled into floats — callers convert explicitly where needed.
 */

export interface SoapClientOptions {
    timeoutMs?: number;
    retries?: number;
    retryDelayMs?: number;
}

/**
 * How the operation element's children are namespace-qualified — the wire consequence of the target
 * schema's `elementFormDefault`. ARCA's services disagree on this, so it is per-call:
 *
 * - `'qualified'` (the default): the operation element declares the target namespace as the DEFAULT
 *   `xmlns`, so every unprefixed child inherits it. What the .NET services want — WSFEv1/WSFEXv1 — and
 *   what WSAA's `loginCms` accepts.
 * - `'unqualified'`: the target namespace rides on a prefix, so ONLY the operation element carries it
 *   and its children stay in no namespace at all. What the JAX-WS padrón services (`sr-padron`) want.
 *   Sending them the qualified form is rejected before the ticket is even looked at, with
 *   `Unmarshalling Error: unexpected element (uri:"http://a5.soap.ws.server.puc.sr/", local:"token").
 *   Expected elements are <{}sign>,<{}token>,<{}cuitRepresentada>,<{}idPersona>` — a SOAP fault that
 *   reads like an auth failure but is purely a body-shape one.
 */
export type ElementForm = 'qualified' | 'unqualified';

export interface SoapCallOptions {
    /**
     * SOAPAction header; defaults to `"{namespace}/{operation}"`. Pass `''` for services (e.g. WSAA)
     * that expect an empty action.
     */
    soapAction?: string;
    /** Namespace form for the operation element's children. Defaults to `'qualified'`. */
    elementForm?: ElementForm;
}

const SOAP_ENVELOPE_NS = 'http://schemas.xmlsoap.org/soap/envelope/';

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Serializes a plain object into element XML for the SOAP body. Nested objects become nested
 * elements; an array repeats its key (`{Iva: [a, b]}` → `<Iva>…a…</Iva><Iva>…b…</Iva>`); primitives
 * become escaped text; `null`/`undefined` are omitted. No attribute support is needed — ARCA request
 * bodies are element-only. Kept in-house to avoid the deprecated `XMLBuilder`.
 */
function serializePayload(payload: Record<string, unknown>): string {
    return Object.entries(payload)
        .map(([key, value]) => serializeElement(key, value))
        .join('');
}

function serializeElement(key: string, value: unknown): string {
    if (value === undefined || value === null) {
        return '';
    }
    if (Array.isArray(value)) {
        return value.map((item) => serializeElement(key, item)).join('');
    }
    if (typeof value === 'object') {
        return `<${key}>${serializePayload(value as Record<string, unknown>)}</${key}>`;
    }
    return `<${key}>${escapeXml(String(value))}</${key}>`;
}

function escapeXml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

export class SoapClient {
    private readonly parser: XMLParser;

    constructor(private readonly options: SoapClientOptions = {}) {
        const parserConfig = {
            ignoreAttributes: false,
            attributeNamePrefix: '@_',
            textNodeName: '#text',
            parseTagValue: false,
            parseAttributeValue: false,
            trimValues: true,
            removeNSPrefix: true,
        };
        this.parser = new XMLParser(parserConfig);
    }

    /**
     * Sends a SOAP request and returns the parsed `<{operation}Response>` element. The caller reads
     * the operation-specific child (e.g. `FECAESolicitarResult`, `loginCmsReturn`) off the result.
     *
     * @param endpoint absolute service URL
     * @param namespace SOAP target namespace, carried by the operation element
     * @param operation operation name, e.g. `"FECAESolicitar"`
     * @param payload object serialized as the operation element's children
     * @param options SOAPAction override and the children's {@link ElementForm}
     */
    async call(
        endpoint: string,
        namespace: string,
        operation: string,
        payload: Record<string, unknown>,
        options: SoapCallOptions = {},
    ): Promise<Record<string, unknown>> {
        const envelope = this.buildEnvelope(namespace, operation, payload, options.elementForm ?? 'qualified');
        const action = options.soapAction ?? this.defaultSoapAction(namespace, operation);
        const rawXml = await this.fetchWithRetry(endpoint, envelope, action);
        return this.extractResponse(rawXml, operation);
    }

    /** Parses a standalone XML string (e.g. the escaped ticket XML nested in a WSAA response). */
    parseXmlString(xml: string): Record<string, unknown> {
        return this.parser.parse(xml) as Record<string, unknown>;
    }

    private defaultSoapAction(namespace: string, operation: string): string {
        return `${namespace}${namespace.endsWith('/') ? '' : '/'}${operation}`;
    }

    private buildEnvelope(
        namespace: string,
        operation: string,
        payload: Record<string, unknown>,
        elementForm: ElementForm,
    ): string {
        const inner = serializePayload(payload);
        // A prefix on the operation element leaves the children in no namespace; a default `xmlns` puts
        // them all in the target one. See {@link ElementForm} — the two are not interchangeable.
        const body =
            elementForm === 'unqualified'
                ? `<ns1:${operation} xmlns:ns1="${namespace}">${inner}</ns1:${operation}>`
                : `<${operation} xmlns="${namespace}">${inner}</${operation}>`;
        return (
            '<?xml version="1.0" encoding="UTF-8"?>' +
            `<soap:Envelope xmlns:soap="${SOAP_ENVELOPE_NS}">` +
            '<soap:Body>' +
            body +
            '</soap:Body></soap:Envelope>'
        );
    }

    private extractResponse(rawXml: string, operation: string): Record<string, unknown> {
        const parsed = this.parser.parse(rawXml) as Record<string, any>;
        const envelope = parsed.Envelope;
        const body = envelope?.Body;
        if (!body) {
            throw new ArcaSoapError('Malformed SOAP response: missing Envelope/Body');
        }
        const fault = body.Fault;
        if (fault) {
            const message = fault.faultstring ?? fault.Reason?.Text?.['#text'] ?? fault.Reason?.Text ?? 'SOAP Fault';
            const faultCode = fault.faultcode ?? fault.Code?.Value;
            throw new ArcaSoapError(String(message), undefined, faultCode ? String(faultCode) : undefined);
        }
        const responseEl = body[`${operation}Response`];
        if (responseEl === undefined) {
            throw new ArcaSoapError(`SOAP response missing <${operation}Response>`);
        }
        return responseEl as Record<string, unknown>;
    }

    private async fetchWithRetry(endpoint: string, envelope: string, soapAction: string): Promise<string> {
        const retries = this.options.retries ?? 2;
        const timeoutMs = this.options.timeoutMs ?? 30_000;
        const baseDelay = this.options.retryDelayMs ?? 500;

        let lastError: unknown;
        for (let attempt = 0; attempt <= retries; attempt++) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'text/xml; charset=utf-8',
                        SOAPAction: soapAction,
                    },
                    body: envelope,
                    signal: controller.signal,
                });
                const text = await response.text();
                if (response.ok) {
                    return text;
                }
                // 5xx is transient and worth another attempt; 4xx is not.
                if (response.status >= 500 && attempt < retries) {
                    lastError = new ArcaSoapError(`SOAP HTTP ${response.status}`, response.status);
                } else {
                    throw new ArcaSoapError(
                        `SOAP HTTP ${response.status}: ${text.slice(0, 500)}`,
                        response.status,
                    );
                }
            } catch (error) {
                lastError = error;
                const isTransportError = !(error instanceof ArcaSoapError) || (error.httpStatus ?? 0) >= 500;
                if (!isTransportError || attempt === retries) {
                    throw error instanceof ArcaError
                        ? error
                        : new ArcaSoapError(`SOAP request failed: ${(error as Error).message ?? String(error)}`);
                }
            } finally {
                clearTimeout(timer);
            }
            await sleep(baseDelay * 2 ** attempt);
        }
        throw lastError instanceof ArcaError ? lastError : new ArcaSoapError('SOAP request failed');
    }
}

import {SoapClient} from './soap-client.js';
import {ArcaSoapError} from './errors.js';

interface FetchCapture {
    url: string;
    headers: Record<string, string>;
    body: string;
}

function mockFetch(responseXml: string, ok = true, status = 200): FetchCapture {
    const capture: FetchCapture = {url: '', headers: {}, body: ''};
    (global as any).fetch = async (url: string, init: any) => {
        capture.url = url;
        capture.headers = init.headers;
        capture.body = init.body;
        return {ok, status, text: async () => responseXml};
    };
    return capture;
}

describe('SoapClient', () => {
    const originalFetch = (global as any).fetch;
    afterEach(() => {
        (global as any).fetch = originalFetch;
    });

    it('builds a namespaced envelope + SOAPAction and returns the operation response element', async () => {
        const responseXml =
            '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>' +
            '<FooResponse><FooResult><Cuit>20123456789</Cuit><Ok>1</Ok></FooResult></FooResponse>' +
            '</soap:Body></soap:Envelope>';
        const capture = mockFetch(responseXml);

        const client = new SoapClient();
        const result: any = await client.call('https://svc/x', 'http://ns.example/', 'Foo', {A: 1});

        expect(capture.headers.SOAPAction).toBe('http://ns.example/Foo');
        expect(capture.headers['Content-Type']).toContain('text/xml');
        expect(capture.body).toContain('<Foo xmlns="http://ns.example/">');
        expect(capture.body).toContain('<A>1</A>');
        // Long digit strings must NOT be coerced to a number (would corrupt CUIT/CAE).
        expect(result.FooResult.Cuit).toBe('20123456789');
        expect(typeof result.FooResult.Cuit).toBe('string');
    });

    it('throws ArcaSoapError on a SOAP Fault', async () => {
        const faultXml =
            '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>' +
            '<soap:Fault><faultcode>soap:Server</faultcode><faultstring>boom</faultstring></soap:Fault>' +
            '</soap:Body></soap:Envelope>';
        mockFetch(faultXml);

        const client = new SoapClient();
        await expect(client.call('https://svc/x', 'http://ns/', 'Foo', {})).rejects.toBeInstanceOf(ArcaSoapError);
    });

    it('accepts an explicit empty SOAPAction (WSAA style)', async () => {
        const responseXml =
            '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>' +
            '<loginCmsResponse><loginCmsReturn>ticket</loginCmsReturn></loginCmsResponse>' +
            '</soap:Body></soap:Envelope>';
        const capture = mockFetch(responseXml);

        const client = new SoapClient();
        const result: any = await client.call('https://wsaa/x', 'http://wsaa.ns', 'loginCms', {in0: 'cms'}, '');

        expect(capture.headers.SOAPAction).toBe('');
        expect(result.loginCmsReturn).toBe('ticket');
    });
});

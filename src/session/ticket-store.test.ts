import {ServiceId, type ServiceIdValue} from '../arca/index.js';
import {TicketRequiredError, TicketStore} from './ticket-store.js';

const CUIT = 20123456789;
const SVC: ServiceIdValue = ServiceId.WSFEV1;
const ENV = 'homologacion' as const;

function inMinutes(mins: number): string {
    return new Date(Date.now() + mins * 60_000).toISOString();
}

describe('TicketStore', () => {
    it('resolves an injected ticket and caches it', () => {
        const store = new TicketStore(undefined);
        const auth = store.resolve(CUIT, SVC, ENV, {token: 't', sign: 's', expiration: inMinutes(60)});
        expect(auth).toEqual({token: 't', sign: 's', cuit: CUIT});
        expect(store.getValid(CUIT, SVC, ENV)).toEqual({token: 't', sign: 's', cuit: CUIT});
    });

    it('throws TicketRequiredError on a cache miss', () => {
        const store = new TicketStore(undefined);
        expect(() => store.resolve(CUIT, SVC, ENV)).toThrow(TicketRequiredError);
    });

    it('treats a near-expiry ticket as missing (refresh margin)', () => {
        const store = new TicketStore(undefined);
        store.put(CUIT, SVC, ENV, {token: 't', sign: 's', expiration: inMinutes(1)});
        expect(store.getValid(CUIT, SVC, ENV)).toBeUndefined();
        expect(() => store.resolve(CUIT, SVC, ENV)).toThrow(TicketRequiredError);
    });

    it('rejects a ticket with an invalid expiration', () => {
        const store = new TicketStore(undefined);
        expect(() => store.put(CUIT, SVC, ENV, {token: 't', sign: 's', expiration: 'not-a-date'})).toThrow();
    });

    it('scopes tickets by (cuit, service, environment)', () => {
        const store = new TicketStore(undefined);
        store.resolve(CUIT, SVC, ENV, {token: 't', sign: 's', expiration: inMinutes(60)});
        expect(store.getValid(CUIT, ServiceId.PADRON_A5, ENV)).toBeUndefined();
        expect(store.getValid(99_999_999_999, SVC, ENV)).toBeUndefined();
        expect(store.getValid(CUIT, SVC, 'produccion')).toBeUndefined();
    });
});

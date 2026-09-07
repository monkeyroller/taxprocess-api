import 'reflect-metadata';
import {afterAll, beforeAll, describe, expect, it} from '@jest/globals';
import type {Server} from 'node:http';
import {createApp} from './app.js';
import {assertDecoratorMetadataEmitted} from './decorator-metadata.js';
import type {HttpErrorResult, ValidationSummary} from './error-mapper/error-mapper.js';

/**
 * The whitelist half of the contract, over a real socket.
 *
 * This file exists because `forbidNonWhitelisted` cannot be observed from the DTO tests. Those call
 * `plainToInstance` + `validate` directly, which is the *second* half of what routing-controllers does; the
 * first half is reading `design:paramtypes` to decide there is a DTO at all. When that read fails the DTO
 * tests still pass, every decorator in `src/http/dto` is skipped at runtime, and the service quietly answers
 * `200` to a body it should refuse. Only a request that crosses the framework catches it — hence the socket.
 *
 * Every case here is rejected before any action runs, so nothing reaches a provider and no network is
 * touched. That is why the invoice bodies are deliberately incomplete: they never get far enough to matter.
 */

let server: Server;
let origin: string;

beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => { resolve(); }));
    const address = server.address();
    if (address === null || typeof address === 'string') {
        throw new Error('expected an AddressInfo from a TCP listener');
    }
    origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => { resolve(); }));
});

/**
 * The envelope as this route produces it: `toHttpError` puts the class-validator summaries in `details`,
 * so the tree walked below is the mapper's own `ValidationSummary`, not a restatement of it.
 */
type ErrorEnvelope = HttpErrorResult['body'] & {
    error: {details?: ReadonlyArray<ValidationSummary>};
};

async function post(path: string, body: unknown): Promise<{status: number; json: ErrorEnvelope}> {
    const res = await fetch(`${origin}${path}`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body),
    });
    return {status: res.status, json: (await res.json()) as ErrorEnvelope};
}

/** Collects every `property` the envelope reports a whitelist violation for, at any nesting depth. */
function rejectedProperties(json: ErrorEnvelope): Array<string> {
    const walk = (nodes: ReadonlyArray<ValidationSummary>): Array<string> =>
        nodes.flatMap((node) => [
            ...(node.constraints?.['whitelistValidation'] !== undefined ? [node.property] : []),
            ...walk(node.children ?? []),
        ]);
    return walk(json.error.details ?? []);
}

/** A structurally valid entity block, so the envelope's own validation is not what fails the case. */
const ENTITY = {entityCode: 'ARCA', issuerTaxId: '20111111112', environment: 'testing'};

describe('unknown request fields are refused (forbidNonWhitelisted)', () => {
    it('emits design:paramtypes — the read every case below depends on', () => {
        expect(() => { assertDecoratorMetadataEmitted(); }).not.toThrow();
    });

    it('rejects a bogus key at the top of the /invoices/authorize envelope', async () => {
        const {status, json} = await post('/api/invoices/authorize', {
            bogusTop: 1,
            entity: ENTITY,
            invoice: {},
        });
        expect(status).toBe(400);
        expect(rejectedProperties(json)).toContain('bogusTop');
    });

    it('rejects a bogus key at the top level of `invoice`', async () => {
        const {status, json} = await post('/api/invoices/authorize', {
            entity: ENTITY,
            invoice: {bogusInvoice: 1},
        });
        expect(status).toBe(400);
        expect(rejectedProperties(json)).toContain('bogusInvoice');
    });

    it('rejects a bogus key inside the nested `invoice.receiver` block', async () => {
        const {status, json} = await post('/api/invoices/authorize', {
            entity: ENTITY,
            invoice: {
                receiver: {
                    identificationTypeCode: 80,
                    identificationNumber: '20111111112',
                    fiscalConditionCode: 1,
                    bogusReceiver: 1,
                },
            },
        });
        expect(status).toBe(400);
        expect(rejectedProperties(json)).toContain('bogusReceiver');
    });

    it('rejects a bogus key inside the nested `invoice.export` block', async () => {
        const {status, json} = await post('/api/invoices/authorize', {
            entity: ENTITY,
            invoice: {
                export: {
                    destinationCode: '203',
                    clientName: 'Buyer SA',
                    clientAddress: 'Rua 1, Sao Paulo',
                    language: 'es',
                    bogusExport: 1,
                },
            },
        });
        expect(status).toBe(400);
        expect(rejectedProperties(json)).toContain('bogusExport');
    });

    it('rejects a bogus key on the flat POST /currencies/rates body', async () => {
        const {status, json} = await post('/api/currencies/rates', {
            entityCode: 'ARCA',
            environment: 'testing',
            bogusFlat: 1,
        });
        expect(status).toBe(400);
        expect(rejectedProperties(json)).toContain('bogusFlat');
    });

    it('rejects a bogus key inside the nested `entity` block', async () => {
        const {status, json} = await post('/api/invoices/authorize', {
            entity: {...ENTITY, bogusEntity: 1},
            invoice: {},
        });
        expect(status).toBe(400);
        expect(rejectedProperties(json)).toContain('bogusEntity');
    });

    it('leaves a body of declared-only fields alone — it fails on its own merits, not the whitelist', async () => {
        // Every key here is declared; the body is refused because `entity` is missing, which is a different
        // rule. Guards against a whitelist so eager it refuses the contract's own fields.
        const {status, json} = await post('/api/invoices/authorize', {invoice: {}});
        expect(status).toBe(400);
        expect(rejectedProperties(json)).toEqual([]);
        // The 400 is over-determined — an empty `invoice` is refused on its own merits, so the status and
        // the empty whitelist above both hold whether or not `entity` is still required. Naming the cause
        // is what keeps this case falsifiable. `required-blocks.contract.test.ts` pins the rule itself;
        // what this adds is that it survives the framework round trip.
        const entityFailure = json.error.details?.find((d) => d.property === 'entity');
        expect(entityFailure?.constraints?.['isDefined']).toBeDefined();
    });
});

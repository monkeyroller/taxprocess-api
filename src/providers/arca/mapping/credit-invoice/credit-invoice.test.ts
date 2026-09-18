import {describe, expect, it} from '@jest/globals';
import {creditInvoiceOptionals, mergeCreditInvoiceOptionals} from './credit-invoice.js';
import {codeOf} from '../validation-error.test-support.js';
import type {NeutralInvoiceCreditInvoice} from '../../../provider/neutral-invoice.js';

/**
 * Turning the neutral `creditInvoice` block into ARCA's `Opcionales`.
 *
 * The ids asserted here are the whole reason the block exists: they are ARCA's, they belong on this side of
 * the boundary, and a caller should never have to know them. So the assertions name them literally — this
 * file is where `2101`, `2102` and `27` are allowed to appear.
 */
describe('creditInvoiceOptionals', () => {
    const CBU = '0170099220000067797112';

    function block(overrides: Partial<NeutralInvoiceCreditInvoice> = {}): NeutralInvoiceCreditInvoice {
        return {issuerCbu: CBU, ...overrides};
    }

    it('maps the CBU to ARCA id 2101', () => {
        expect(creditInvoiceOptionals(block())).toContainEqual({id: '2101', value: CBU});
    });

    it('maps the alias to ARCA id 2102, and omits it entirely when there is none', () => {
        expect(creditInvoiceOptionals(block({issuerCbuAlias: 'MI.ALIAS.CBU'}))).toContainEqual({
            id: '2102',
            value: 'MI.ALIAS.CBU',
        });
        expect(creditInvoiceOptionals(block()).map((o) => o.id)).not.toContain('2102');
    });

    it('defaults the transmission mode to SCA, so a caller with no opinion carries no field', () => {
        // Answering core's question: the régimen's default is derivable here, so `transmissionMode` need
        // not be on the wire at all until someone actually wants `ADC`.
        expect(creditInvoiceOptionals(block())).toContainEqual({id: '27', value: 'SCA'});
    });

    it('carries an explicit mode through', () => {
        expect(creditInvoiceOptionals(block({transmissionMode: 'ADC'}))).toContainEqual({id: '27', value: 'ADC'});
    });

    it('emits ids as strings, since Opcional.Id travels as sent and is never coerced', () => {
        for (const optional of creditInvoiceOptionals(block({issuerCbuAlias: 'A.B.C'}))) {
            expect(typeof optional.id).toBe('string');
        }
    });
});

describe('mergeCreditInvoiceOptionals', () => {
    const CBU = '0170099220000067797112';
    const OTHER = {id: '1010', value: 'algo'};
    /** FCE Factura A — a type the block belongs on. */
    const FCE = 201;
    /** Ordinary Factura A — a type it does not. */
    const PLAIN = 1;

    it('is absent when there is nothing to send, so no empty Opcionales element is produced', () => {
        expect(mergeCreditInvoiceOptionals(PLAIN, undefined, undefined)).toBeUndefined();
        expect(mergeCreditInvoiceOptionals(PLAIN, undefined, [])).toBeUndefined();
    });

    it('relays a caller optionals[] untouched when there is no creditInvoice block', () => {
        // The open relay still works exactly as before. Nothing here forbids doing it the old way.
        expect(mergeCreditInvoiceOptionals(PLAIN, undefined, [OTHER])).toEqual([OTHER]);
    });

    it('carries both channels when they do not overlap', () => {
        const merged = mergeCreditInvoiceOptionals(FCE, {issuerCbu: CBU}, [OTHER]);

        expect(merged).toContainEqual({id: '2101', value: CBU});
        expect(merged).toContainEqual(OTHER);
    });

    it.each(['2101', '2102', '27'])('refuses id %s sent both ways rather than picking a winner', (id) => {
        // Neither precedence rule is defensible, and both put a bank account on a fiscal document that the
        // caller did not unambiguously ask for — invisibly. A `400` naming the collision is answerable from
        // the body and costs nobody a login.
        const call = (): unknown =>
            mergeCreditInvoiceOptionals(FCE, {issuerCbu: CBU, issuerCbuAlias: 'A.B.C'}, [
                {id, value: 'otra cosa'},
            ]);

        expect(codeOf(call)).toBe('CREDIT_INVOICE_OPTIONAL_CONFLICT');
    });

    it('detects a collision even when the caller padded the id', () => {
        const call = (): unknown =>
            mergeCreditInvoiceOptionals(FCE, {issuerCbu: CBU}, [{id: ' 2101 ', value: 'x'}]);

        expect(codeOf(call)).toBe('CREDIT_INVOICE_OPTIONAL_CONFLICT');
    });

    it.each([201, 202, 203, 206, 207, 208, 211, 212, 213])(
        'requires the block on FCE type %s, since the authority demands an account it never named to the caller',
        (documentTypeCode) => {
            // The expensive direction. Without this the voucher is refused by ARCA for a missing `2101`,
            // which is a field the contract deliberately never asked the caller to know about.
            expect(codeOf(() => mergeCreditInvoiceOptionals(documentTypeCode, undefined, undefined))).toBe(
                'CREDIT_INVOICE_REQUIRED',
            );
        },
    );

    it('refuses the block on a document type that is not a credit invoice', () => {
        expect(codeOf(() => mergeCreditInvoiceOptionals(PLAIN, {issuerCbu: CBU}, undefined))).toBe(
            'CREDIT_INVOICE_NOT_APPLICABLE',
        );
    });

    it('leaves every non-FCE type alone when no block is sent', () => {
        // The check must not touch the overwhelmingly common voucher, which names neither.
        expect(mergeCreditInvoiceOptionals(PLAIN, undefined, [OTHER])).toEqual([OTHER]);
        expect(mergeCreditInvoiceOptionals(6, undefined, undefined)).toBeUndefined();
    });

    it('accepts an FCE whose CBU came through optionals[] instead of the block', () => {
        // The relay predates the block and the contract promises it still works. A caller already
        // assembling 2101 by hand is issuing a perfectly good FCE, so the rule is that the account is
        // present — not which channel carried it.
        const relayedCbu = [{id: '2101', value: CBU}];

        expect(mergeCreditInvoiceOptionals(FCE, undefined, relayedCbu)).toEqual(relayedCbu);
        expect(mergeCreditInvoiceOptionals(FCE, undefined, [{id: ' 2101 ', value: CBU}])).toBeDefined();
    });

    it('does not police raw ids on a non-FCE voucher, since that channel is deliberately open', () => {
        // Only the typed block is constrained the other way. ARCA names new optional fields by regulation,
        // and a membership check here would refuse the next one before anybody could send it.
        expect(mergeCreditInvoiceOptionals(PLAIN, undefined, [{id: '2101', value: CBU}])).toEqual([
            {id: '2101', value: CBU},
        ]);
    });
});

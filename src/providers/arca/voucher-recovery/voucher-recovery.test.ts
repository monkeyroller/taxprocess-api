import {describe, expect, it} from '@jest/globals';
import {assertRecoveredExportVoucherMatches, WSFEX_RECOVERY} from './voucher-recovery.js';
import {ArcaValidationError} from '../sdk/core/errors.js';
import type {FexInvoiceRequest, FexInvoiceResult} from '../sdk/invoicing/export/fex-invoice.types.js';

/** What we tried to authorize. */
const SENT: FexInvoiceRequest = {
    requestId: 41,
    voucherType: 19,
    pointOfSaleNumber: 3,
    voucherNumber: 7,
    voucherDate: '20260904',
    exportType: 2,
    destinationCode: 203,
    clientName: 'Joao Da Silva',
    clientAddress: 'Rua 76 km 34.5 Alagoas',
    clientTaxId: 'PJ54482221-l',
    clientCountryTaxId: 50000000059,
    currencyId: 'DOL',
    currencyRate: 1508,
    totalAmount: 500,
    language: 1,
    items: [{description: 'Consultoría', unitOfMeasure: 7, totalAmount: 500}],
};

/**
 * What the authority has on file. Values are strings on purpose: the SOAP client parses with
 * `parseTagValue: false`, so this is the shape the guard sees in production, and stubbing numbers would
 * hide how a blank element behaves.
 */
function stored(raw: Record<string, unknown> = {}): FexInvoiceResult {
    return {
        result: 'A',
        cae: '69000000000001',
        caeExpiration: '20261015',
        voucherNumber: 7,
        voucherDate: '20260904',
        requestId: 41,
        reprocessed: false,
        observations: [],
        raw: {
            Id: '41',
            Imp_total: '500',
            Moneda_Id: 'DOL',
            Fecha_cbte: '20260904',
            Dst_cmp: '203',
            Tipo_expo: '2',
            Cuit_pais_cliente: '50000000059',
            ...raw,
        },
    };
}

describe('assertRecoveredExportVoucherMatches', () => {
    it('accepts the voucher it was asked about', () => {
        expect(() => assertRecoveredExportVoucherMatches(SENT, stored())).not.toThrow();
    });

    it.each([
        ['request id', {Id: '99'}],
        ['amount', {Imp_total: '999'}],
        ['currency', {Moneda_Id: 'PES'}],
        ['voucher date', {Fecha_cbte: '20260101'}],
        ['destination', {Dst_cmp: '250'}],
        ['export type', {Tipo_expo: '1'}],
        ["buyer's country tax id", {Cuit_pais_cliente: '50000000016'}],
    ])('refuses a CAE stored against a different %s', (label, raw) => {
        expect(() => assertRecoveredExportVoucherMatches(SENT, stored(raw))).toThrow(
            new RegExp(`different ${label}`),
        );
        try {
            assertRecoveredExportVoucherMatches(SENT, stored(raw));
        } catch (err) {
            expect(err).toBeInstanceOf(ArcaValidationError);
            expect((err as ArcaValidationError).code).toBe('VOUCHER_ALREADY_AUTHORIZED_MISMATCH');
        }
    });

    it('treats an EMPTY stored element as "not returned", not as a zero that mismatches', () => {
        // The parser reads a blank element as `''`, and `Number('')` is a finite `0` -- which would report
        // every unreturned field as a confirmed difference and refuse a legitimate recovery.
        const blank = stored({
            Id: '',
            Imp_total: '',
            Moneda_Id: '',
            Fecha_cbte: '',
            Dst_cmp: '',
            Tipo_expo: '',
            Cuit_pais_cliente: '',
        });
        expect(() => assertRecoveredExportVoucherMatches(SENT, blank)).not.toThrow();
    });

    it('tolerates rounding drift on the amount, which is why the total carries a tolerance', () => {
        expect(() => assertRecoveredExportVoucherMatches(SENT, stored({Imp_total: '500.009'}))).not.toThrow();
        expect(() => assertRecoveredExportVoucherMatches(SENT, stored({Imp_total: '500.02'}))).toThrow();
    });

    it('says nothing about a field the caller never sent', () => {
        // Both conditional comparisons skip when our side is absent: a stored value cannot contradict
        // something we did not claim.
        const {clientCountryTaxId: _dropped, ...withoutCountryTaxId} = SENT;
        expect(() =>
            assertRecoveredExportVoucherMatches(withoutCountryTaxId, stored({Cuit_pais_cliente: '50000000016'})),
        ).not.toThrow();
    });

    it('compares nothing that ARCA may normalize or re-render', () => {
        // Free text and arrays are excluded for the reason the domestic guard gives: they are too fragile to
        // compare against the authority's own wire representation.
        const reworded = stored({
            Cliente: 'JOAO DA SILVA',
            Domicilio_cliente: 'RUA 76',
            Id_impositivo: 'OTRO',
            Moneda_ctz: '1509.5',
            Items: [{Pro_ds: 'algo distinto'}],
        });
        expect(() => assertRecoveredExportVoucherMatches(SENT, reworded)).not.toThrow();
    });
});

describe('WSFEX_RECOVERY', () => {
    it('treats every rejection as a candidate, having no code to filter on', () => {
        // WSFEX's Motivos_Obs is one delimited string read into a code-less entry, so unlike WSFEv1 there is
        // nothing to test before deciding a rejection is worth a query.
        expect(WSFEX_RECOVERY.isConflictCandidate({...stored(), result: 'R'})).toBe(true);
        expect(WSFEX_RECOVERY.isConflictError(new Error('anything') as never)).toBe(true);
    });

    it('does not reconcile an approved voucher', () => {
        expect(WSFEX_RECOVERY.isConflictCandidate(stored())).toBe(false);
    });

    it('reads the voucher number the export result carries', () => {
        // FexInvoiceResult names it `voucherNumber`; the domestic one names it `voucherNumberFrom`. That
        // difference is the whole reason the engine asks the dialect rather than reading it itself.
        expect(WSFEX_RECOVERY.voucherNumberOf(stored())).toBe(7);
    });
});

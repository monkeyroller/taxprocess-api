import {describe, expect, it} from '@jest/globals';
import {invoiceRoute, isExportDocumentType} from './invoice-routing.js';
import {ArcaValidationError} from '../../sdk/core/errors.js';

describe('isExportDocumentType', () => {
    it('names the three types only WSFEXv1 authorizes', () => {
        expect([19, 20, 21].every(isExportDocumentType)).toBe(true);
    });

    it('excludes the domestic types', () => {
        expect([1, 6, 11, 51, 201, 211].some(isExportDocumentType)).toBe(false);
    });

    it('excludes 22, which WSFEXv1 neither publishes nor validates', () => {
        // A legacy code in ARCA's master table, not the Exporta Simple document type — that regime is
        // invoiced as a `19` carrying simplified-export `Opcionales`. Routing 22 to WSFEXv1 would only
        // produce a rejection the caller cannot read.
        expect(isExportDocumentType(22)).toBe(false);
    });

    it('excludes 88 and 89, which the service catalogue publishes but cannot authorize', () => {
        // `FEXGetPARAM_Cbte_Tipo` returns them alongside 19/20/21, so a set derived from that catalogue
        // would route two codes ARCA only accepts inside `Cmps_asoc`.
        expect([88, 89].some(isExportDocumentType)).toBe(false);
    });
});

describe('invoiceRoute', () => {
    it('defaults to WSFEv1, which is what callers got before it existed', () => {
        expect(invoiceRoute({})).toBe('WSFEV1');
        expect(invoiceRoute({documentTypeCode: 6})).toBe('WSFEV1');
    });

    it('resolves an export document type on its own', () => {
        expect(invoiceRoute({documentTypeCode: 19})).toBe('WSFEXV1');
        expect(invoiceRoute({documentTypeCode: 20})).toBe('WSFEXV1');
        expect(invoiceRoute({documentTypeCode: 21})).toBe('WSFEXV1');
    });

    it('lets an explicit webService decide when there is no document type', () => {
        // The rates and points-of-sale lookups have no voucher, so this is their only key.
        expect(invoiceRoute({webService: 'WSFEXv1'})).toBe('WSFEXV1');
        expect(invoiceRoute({webService: 'WSFEv1'})).toBe('WSFEV1');
        expect(invoiceRoute({webService: 'WSMTXCA'})).toBe('WSMTXCA');
    });

    it('separates the two domestic services, which no document type could', () => {
        // WSFEv1 and WSMTXCA both issue 1/6/11, so the selector is the only thing that can tell them apart.
        expect(invoiceRoute({webService: 'WSMTXCA', documentTypeCode: 6})).toBe('WSMTXCA');
        expect(invoiceRoute({webService: 'WSFEv1', documentTypeCode: 6})).toBe('WSFEV1');
    });

    it('agrees with itself when both inputs point the same way', () => {
        expect(invoiceRoute({webService: 'WSFEXv1', documentTypeCode: 19})).toBe('WSFEXV1');
    });

    it('raises when the selector and the document type disagree', () => {
        // A caller bug either way: guessing which field is wrong would authorize a voucher through a service
        // the caller did not mean.
        expect(() => invoiceRoute({webService: 'WSFEv1', documentTypeCode: 19})).toThrow(ArcaValidationError);
        expect(() => invoiceRoute({webService: 'WSMTXCA', documentTypeCode: 21})).toThrow(ArcaValidationError);
        expect(() => invoiceRoute({webService: 'WSFEXv1', documentTypeCode: 6})).toThrow(ArcaValidationError);
    });

    it('names the mismatch with its own code so a caller can branch without parsing Spanish', () => {
        const failure = (() => {
            try {
                invoiceRoute({webService: 'WSFEXv1', documentTypeCode: 6});
                return undefined;
            } catch (err) {
                return err as ArcaValidationError;
            }
        })();

        expect(failure?.code).toBe('WEB_SERVICE_DOCUMENT_TYPE_MISMATCH');
        expect(failure?.message).toContain('19, 20 and 21');
    });
});

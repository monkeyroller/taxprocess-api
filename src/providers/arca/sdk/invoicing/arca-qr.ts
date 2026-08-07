/**
 * ARCA electronic-invoice QR (RG 4892) and the `yyyymmdd` date format ARCA uses on the wire.
 * Pure functions — no I/O — so they live in the SDK and are unit-testable in isolation.
 */

const ARGENTINA_TZ = 'America/Argentina/Buenos_Aires';

/** Argentina-local calendar parts of a date. */
export function argentinaDateParts(date: Date): {year: string; month: string; day: string} {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: ARGENTINA_TZ,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(date);
    const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
    return {year: get('year'), month: get('month'), day: get('day')};
}

/** Formats a date as ARCA `yyyymmdd` in Argentina local time. */
export function formatArcaDate(date: Date): string {
    const {year, month, day} = argentinaDateParts(date);
    return `${year}${month}${day}`;
}

/** Parses ARCA `yyyymmdd` into a Date at Argentina midnight (UTC-03:00). */
export function parseArcaDate(yyyymmdd: string): Date {
    const y = yyyymmdd.slice(0, 4);
    const m = yyyymmdd.slice(4, 6);
    const d = yyyymmdd.slice(6, 8);
    return new Date(`${y}-${m}-${d}T00:00:00-03:00`);
}

/** Inputs for the RG 4892 QR payload. */
export interface ArcaQrParams {
    /** Voucher date. */
    date: Date;
    /** Issuer CUIT (digits). */
    cuit: number;
    /** `PtoVta`. */
    salesPointNumber: number;
    /** `CbteTipo`. */
    voucherType: number;
    /** `CbteNro`. */
    voucherNumber: number;
    /** `ImpTotal`. */
    totalAmount: number;
    /** ARCA `MonId`. */
    currencyId: string;
    /** `MonCotiz`. */
    currencyRate: number;
    /** Receiver document type (ARCA DocTipo). */
    docType: number;
    /** Receiver document number. */
    docNumber: number;
    /** The CAE number. */
    cae: string;
}

/** Builds the ARCA RG 4892 QR URL: `https://www.arca.gob.ar/fe/qr/?p=<base64(json)>`. */
export function buildArcaQrUrl(params: ArcaQrParams): string {
    const {year, month, day} = argentinaDateParts(params.date);
    const payload = {
        ver: 1,
        fecha: `${year}-${month}-${day}`,
        cuit: params.cuit,
        ptoVta: params.salesPointNumber,
        tipoCmp: params.voucherType,
        nroCmp: params.voucherNumber,
        importe: params.totalAmount,
        moneda: params.currencyId,
        ctz: params.currencyRate,
        tipoDocRec: params.docType,
        nroDocRec: params.docNumber,
        tipoCodAut: 'E',
        codAut: Number(params.cae),
    };
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
    return `https://www.arca.gob.ar/fe/qr/?p=${encoded}`;
}

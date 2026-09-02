/** ARCA's electronic-invoice QR (RG 4892) and the `yyyymmdd` date format it uses on the wire. */

const ARGENTINA_TZ = 'America/Argentina/Buenos_Aires';

/**
 * Argentina's fixed UTC offset, for the places a zone *name* cannot be used — building an instant out of a
 * calendar day, where the offset has to be written into the string `Date` parses.
 *
 * Named here, beside the zone it has to agree with, rather than inlined at each use: the two agree only
 * while Argentina has no DST, and a reinstated DST would need every one of these revisited together. Spelled
 * out separately, the caveat was attached to one of the three copies and the other two read as constants.
 */
export const ARGENTINA_UTC_OFFSET = '-03:00';

/**
 * The two formatters, built once per process. `Intl.DateTimeFormat`'s cost is almost entirely in constructing
 * it, while `formatToParts` on an existing one is cheap — and `formatArcaDate` is on the path of every
 * voucher. They are stateless, the instant being an argument, so sharing them is safe.
 *
 * Both are `en-CA` for its zero-padded numeric output, and both name the zone explicitly rather than relying
 * on `Date`'s local getters: the answer must be the same on a `TZ=UTC` container as on one in Buenos Aires,
 * which is why anything deciding which ARCA day it is comes through here.
 */
const DATE_PARTS_FORMAT = new Intl.DateTimeFormat('en-CA', {
    timeZone: ARGENTINA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});

const CLOCK_PARTS_FORMAT = new Intl.DateTimeFormat('en-CA', {
    timeZone: ARGENTINA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
});

/** Reads one formatter's parts of `date` as a lookup by part type. */
function partsOf(format: Intl.DateTimeFormat, date: Date): (type: string) => string {
    const parts = format.formatToParts(date);
    return (type) => parts.find((p) => p.type === type)?.value ?? '';
}

/** Argentina-local calendar parts of a date. */
export function argentinaDateParts(date: Date): {year: string; month: string; day: string} {
    const get = partsOf(DATE_PARTS_FORMAT, date);
    return {year: get('year'), month: get('month'), day: get('day')};
}

/**
 * Argentina-local wall-clock parts of an instant, including the hour and minute. On its own formatter rather
 * than the one `argentinaDateParts` reads from, since that is the hot path and had been formatting a time of
 * day nothing read.
 *
 * The remaining consumer is the cotización-day probe, which stamps each reading with the ART wall clock it
 * was taken at. Exported for it rather than inlined there so the zone is named once.
 */
export function argentinaClockParts(date: Date): {
    year: string;
    month: string;
    day: string;
    hour: string;
    minute: string;
} {
    const get = partsOf(CLOCK_PARTS_FORMAT, date);
    return {
        year: get('year'),
        month: get('month'),
        day: get('day'),
        hour: get('hour'),
        minute: get('minute'),
    };
}

/** Formats a date as ARCA `yyyymmdd` in Argentina local time. */
export function formatArcaDate(date: Date): string {
    const {year, month, day} = argentinaDateParts(date);
    return `${year}${month}${day}`;
}

/** Parses ARCA `yyyymmdd` into a Date at Argentina midnight, per {@link ARGENTINA_UTC_OFFSET}. */
export function parseArcaDate(yyyymmdd: string): Date {
    const y = yyyymmdd.slice(0, 4);
    const m = yyyymmdd.slice(4, 6);
    const d = yyyymmdd.slice(6, 8);
    return new Date(`${y}-${m}-${d}T00:00:00${ARGENTINA_UTC_OFFSET}`);
}

/** Inputs for the RG 4892 QR payload. */
export interface ArcaQrParams {
    /** Voucher date. */
    date: Date;
    /** Issuer CUIT (digits). */
    cuit: number;
    /** `PtoVta`. */
    pointOfSaleNumber: number;
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

/** The RG 4892 QR URL: `https://www.arca.gob.ar/fe/qr/?p=<base64(json)>`. */
export function buildArcaQrUrl(params: ArcaQrParams): string {
    const {year, month, day} = argentinaDateParts(params.date);
    const payload = {
        ver: 1,
        fecha: `${year}-${month}-${day}`,
        cuit: params.cuit,
        ptoVta: params.pointOfSaleNumber,
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

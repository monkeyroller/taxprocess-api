/** Result of the next-expected-voucher-number lookup — one entry per requested document-type code. */

/** One entry of `POST /invoices/next-numbers`: the next expected number for a document type. */
export class NextNumberDto {
    /** Echoes the requested canonical code (AR: CbteTipo); core maps the response back by this code. */
    documentTypeCode!: number;

    /** Next voucher number the authority expects (AR: FECompUltimoAutorizado + 1; never-authorized → 1). */
    nextNumber!: number;
}

/** Result of `POST /invoices/next-numbers` — one entry per requested document-type code. */
export class NextNumbersResultDto {
    numbers!: Array<NextNumberDto>;
}

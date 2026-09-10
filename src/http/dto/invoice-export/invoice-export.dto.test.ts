import 'reflect-metadata';
import {describe, expect, it} from '@jest/globals';
import {plainToInstance} from 'class-transformer';
import {validate} from 'class-validator';
import {InvoiceExportDto, InvoiceItemDto} from './invoice-export.dto.js';
import {InvoiceLineType} from '../../../providers/provider/invoice-line-type/invoice-line-type.js';

/** A valid services export block — the shape with the fewest conditional fields switched on. */
const block = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    destinationCode: '203',
    clientName: 'Joao Da Silva',
    clientAddress: 'Rua 76 km 34.5 Alagoas',
    clientTaxId: 'PJ54482221-l',
    language: 'es',
    ...overrides,
});

/**
 * The broken rules only — `constraints`, not the whole `ValidationError`.
 *
 * A `ValidationError` carries `target`, which is the request body verbatim, so stringifying the error
 * echoes every field name the caller sent. `toContain('destinationCode')` then passes because the payload
 * *mentions* the field, whichever rule actually failed, and an assertion that cannot tell which rule fired
 * cannot catch one reporting the wrong field.
 */
const messagesOf = async (body: Record<string, unknown>): Promise<string> =>
    JSON.stringify((await validate(plainToInstance(InvoiceExportDto, body))).map((e) => e.constraints));

describe('InvoiceExportDto', () => {
    it('accepts a minimal services export', async () => {
        expect(await validate(plainToInstance(InvoiceExportDto, block()))).toEqual([]);
    });

    it('accepts a goods export carrying a shipping permit', async () => {
        expect(
            await validate(
                plainToInstance(
                    InvoiceExportDto,
                    block({
                        shippingPermitPresent: true,
                        shippingPermits: [{permitId: '09052EC01006154G', destinationCode: '203'}],
                        incoterm: 'CIF',
                    }),
                ),
            ),
        ).toEqual([]);
    });

    it('trims a padded code rather than answering a whitespace mistake with a length', async () => {
        // The same rule `unitOfMeasureCode` follows, and for the same reason: `toDstCmp` and `toIncoterms`
        // both normalize by trimming, so refusing padding here refuses it a layer before the tolerance.
        expect(await validate(plainToInstance(InvoiceExportDto, block({destinationCode: '203 '})))).toEqual(
            [],
        );
        expect(await validate(plainToInstance(InvoiceExportDto, block({incoterm: ' FOB'})))).toEqual([]);
        // The whole group, since every one of their bounds is the code's own width: an 11-digit per-country
        // CUIT with a trailing space is 12 characters, and `toCountryTaxId` would have trimmed it.
        expect(
            await validate(plainToInstance(InvoiceExportDto, block({clientCountryTaxId: '50000000059 '}))),
        ).toEqual([]);
        // Padding is not a code: trimming to nothing still fails, on the length it actually has.
        expect(
            await validate(plainToInstance(InvoiceExportDto, block({destinationCode: '   '}))),
        ).not.toEqual([]);
    });

    it('accepts the Tierra del Fuego destination, which ISO cannot name', async () => {
        expect(await validate(plainToInstance(InvoiceExportDto, block({destinationCode: '250'})))).toEqual(
            [],
        );
    });

    describe('the buyer has to be identifiable', () => {
        it('accepts either identifier alone', async () => {
            expect(await messagesOf(block())).toBe('[]');
            const {clientTaxId: _dropped, ...rest} = block();
            expect(await messagesOf({...rest, clientCountryTaxId: '50000000059'})).toBe('[]');
        });

        it('refuses a block naming neither', async () => {
            // Neither can be unconditionally required: the per-country id does not exist for every
            // destination, and the buyer's own is a foreign identifier a caller may not hold.
            const {clientTaxId: _dropped, ...rest} = block();
            expect(await messagesOf(rest)).toContain('no tax identification');
        });
    });

    it('says nothing about permits, which now need the invoice to judge', async () => {
        // "A shipment can only accompany goods" reads `concept`, which lives on the invoice -- and a
        // class-level validator sees only the object it is attached to. The rule moved to
        // `NeutralInvoiceDto`, which is the only place both halves are visible; see its test.
        expect(await messagesOf(block({shippingPermitPresent: true}))).toBe('[]');
        expect(await messagesOf(block({shippingPermits: [{permitId: 'X', destinationCode: '203'}]}))).toBe(
            '[]',
        );
    });

    describe('closed vocabularies', () => {
        it('refuses an unknown language', async () => {
            // What was being exported used to be a closed set here too. It is now `invoice.concept`, one
            // catalogue serving both document kinds.
            expect(await messagesOf(block({language: 'fr'}))).toContain('language');
        });
    });

    it('refuses a zoneless datetime for the payment date, as every other date on this wire does', async () => {
        expect(await messagesOf(block({paymentDate: '2026-09-30T12:00:00'}))).toContain('paymentDate');
        expect(await messagesOf(block({paymentDate: '2026-09-30'}))).toBe('[]');
    });
});

describe('InvoiceItemDto', () => {
    const item = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
        description: 'Consultoría',
        unitOfMeasureCode: 'C62',
        totalAmount: 500,
        ...overrides,
    });

    /** The broken rules as one string, for the reason {@link messagesOf} gives: no echoed `target`. */
    const messagesOfItem = async (raw: Record<string, unknown>): Promise<string> =>
        JSON.stringify((await validate(plainToInstance(InvoiceItemDto, raw))).map((e) => e.constraints));

    it('accepts a minimal product line', async () => {
        expect(await validate(plainToInstance(InvoiceItemDto, item()))).toEqual([]);
    });

    it('takes the unit as a standard code rather than an authority id', async () => {
        // The whole point of the change: a caller says KGM, not the number ARCA happens to file it under.
        expect(await messagesOfItem(item({unitOfMeasureCode: 'KGM'}))).toBe('[]');
        expect(await messagesOfItem(item({unitOfMeasureCode: 7}))).toContain('unitOfMeasureCode');
        expect(await messagesOfItem(item({unitOfMeasureCode: ''}))).toContain('unitOfMeasureCode');
    });

    it('trims the code before measuring it, so padding is not answered as a length', async () => {
        // `@Length(1, 3)` would otherwise refuse `"KGM "` for being four characters and never mention the
        // padding -- and refuse it ahead of the provider's normalizer, whose job is that a body arrives raw.
        expect(await messagesOfItem(item({unitOfMeasureCode: 'KGM '}))).toBe('[]');
        expect(await messagesOfItem(item({unitOfMeasureCode: '  c62'}))).toBe('[]');
        // Padding is not a code. Trimming to nothing still fails, on the length it actually has.
        expect(await messagesOfItem(item({unitOfMeasureCode: '   '}))).toContain('unitOfMeasureCode');
    });

    it('leaves membership to the provider, which is the only layer that can tell the two refusals apart', async () => {
        // `KGX` does not exist and `HUR` exists but ARCA cannot express it. Both pass here and are refused
        // differently downstream; deciding either at this layer would need a catalogue §9 keeps out of it.
        expect(await messagesOfItem(item({unitOfMeasureCode: 'KGX'}))).toBe('[]');
        expect(await messagesOfItem(item({unitOfMeasureCode: 'HUR'}))).toBe('[]');
    });

    it('names the scheme only from the closed vocabulary', async () => {
        expect(await messagesOfItem(item({unitOfMeasureCodeScheme: 'UN-ECE-REC20'}))).toBe('[]');
        expect(await messagesOfItem(item({unitOfMeasureCodeScheme: 'ARCA'}))).toContain(
            'unitOfMeasureCodeScheme',
        );
    });

    it('requires a product line to say what it is measured in', async () => {
        const {unitOfMeasureCode: _u, ...noUnit} = item();
        expect(await messagesOfItem(noUnit)).toContain('unitOfMeasureCode');
        // Saying PRODUCT explicitly is the same line as saying nothing, so it needs a unit too.
        expect(await messagesOfItem({...noUnit, lineType: InvoiceLineType.PRODUCT})).toContain(
            'unitOfMeasureCode',
        );
    });

    it('still requires a description', async () => {
        const {description: _d, ...noDescription} = item();
        expect(await messagesOfItem(noDescription)).toContain('description');
    });

    it('takes no unit on a line that describes the line rather than the goods', async () => {
        // A discount is not measured in anything, so carrying a unit is a contradiction rather than surplus.
        const {unitOfMeasureCode: _u, ...bare} = item();
        expect(await messagesOfItem({...bare, lineType: InvoiceLineType.DEPOSIT, totalAmount: 200})).toBe(
            '[]',
        );
        // Matched with the closing quote of the JSON string: `unitOfMeasureCode` is a prefix of
        // `unitOfMeasureCodeScheme`, so the bare name would pass on either of the two messages.
        expect(
            await messagesOfItem({...item(), lineType: InvoiceLineType.DEPOSIT, totalAmount: 200}),
        ).toContain('takes no unitOfMeasureCode"');
        // And no catalogue either: naming where a forbidden code came from is the same contradiction. Said
        // here rather than left to the provider, which only reads the scheme on a product line.
        expect(
            await messagesOfItem({
                ...bare,
                lineType: InvoiceLineType.DEPOSIT,
                unitOfMeasureCodeScheme: 'UN-ECE-REC20',
                totalAmount: 200,
            }),
        ).toContain('takes no unitOfMeasureCodeScheme"');
    });

    it('prices no quantity on a line that is not selling anything', async () => {
        // The 1775 rule, restated in the neutral vocabulary -- it used to need ARCA's numbering to say.
        const deposit = (overrides: Record<string, unknown>): Record<string, unknown> => {
            const {unitOfMeasureCode: _u, ...bare} = item();
            return {...bare, lineType: InvoiceLineType.DEPOSIT, totalAmount: 200, ...overrides};
        };
        expect(await messagesOfItem(deposit({quantity: 1}))).toContain('quantity');
        expect(await messagesOfItem(deposit({unitPrice: 50}))).toContain('unitPrice');
        expect(await messagesOfItem(deposit({discount: 5}))).toContain('discount');
        // An explicit zero is what the rule asks for, not an omission -- both pass.
        expect(await messagesOfItem(deposit({quantity: 0, unitPrice: 0}))).toBe('[]');
        expect(await messagesOfItem(deposit({}))).toBe('[]');
        // And a `null` is an omission, matching `@IsOptional()`, which skips `@IsNumber()` for one too. A
        // caller whose serializer writes omitted optionals as null is not sending a quantity.
        expect(await messagesOfItem(deposit({quantity: null, unitPrice: null, discount: null}))).toBe('[]');
    });

    it('requires a discount to subtract, and lets a deposit go either way', async () => {
        // The 1815 rule. That a discount is negative is what the word means, not something ARCA decided.
        const line = (lineType: InvoiceLineType, totalAmount: number): Record<string, unknown> => {
            const {unitOfMeasureCode: _u, ...bare} = item();
            return {...bare, lineType, totalAmount};
        };
        expect(await messagesOfItem(line(InvoiceLineType.DISCOUNT, 50))).toContain('negative');
        expect(await messagesOfItem(line(InvoiceLineType.DISCOUNT, 0))).toContain('negative');
        expect(await messagesOfItem(line(InvoiceLineType.DISCOUNT, -50))).toBe('[]');
        expect(await messagesOfItem(line(InvoiceLineType.DEPOSIT, 50))).toBe('[]');
        expect(await messagesOfItem(line(InvoiceLineType.DEPOSIT, -50))).toBe('[]');
    });

    it('accepts a negative total on an ordinary line, whose sign belongs to the entity and not here', async () => {
        expect(await messagesOfItem(item({totalAmount: -50}))).toBe('[]');
    });

    it('names only line types from the closed vocabulary', async () => {
        expect(await messagesOfItem(item({lineType: 'BONIFICACION'}))).toContain('lineType');
    });
});

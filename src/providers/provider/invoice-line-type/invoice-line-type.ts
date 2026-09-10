/**
 * What an invoice line **is**, as distinct from what it is measured in — a closed vocabulary shared by every
 * provider.
 *
 * An authority may say this through its unit field: ARCA reserves three `Pro_umed` ids for it (`0` no unit,
 * `97` seña/anticipo, `99` bonificación), which is why the two were one field on this wire before. They are
 * not one thing. A discount is not a unit of measure, it changes which amount rules apply to the line, and a
 * caller should not have to learn an authority's numbering to say "this line is a discount".
 *
 * Separating them is what lets `unitOfMeasureCode` be a standard — UN/ECE Recommendation 20 has no code for
 * a discount line and never will, because that is not what a unit is.
 *
 * The same three rules the address schemes follow apply here:
 *
 * - Member values are the contract; member names are not. Adding a member is additive, changing a value
 *   breaking.
 * - Spelling stays key-safe (`/^[A-Z0-9_]+$/`).
 * - A member names what the line is, never what any one authority calls it. A provider maps these to
 *   whatever it uses, exactly as it maps a currency.
 */
export enum InvoiceLineType {
    /**
     * An ordinary product or service line. Carries a `unitOfMeasureCode` and, normally, a quantity and a
     * unit price. This is what a line is when it says nothing, so the field is optional on the wire.
     */
    PRODUCT = 'PRODUCT',
    /**
     * A lump sum: priced as a whole, with no unit, no quantity and no unit price. (AR: `Pro_umed` `0`,
     * whose rule 1775 is exactly this.)
     */
    LUMP_SUM = 'LUMP_SUM',
    /** A discount. Its total is negative, which is what the word means. (AR: `Pro_umed` `99`.) */
    DISCOUNT = 'DISCOUNT',
    /**
     * A deposit or advance against the sale. Unrestricted in sign — it may be either, which is the one thing
     * that distinguishes it from a discount. (AR: `Pro_umed` `97`.)
     */
    DEPOSIT = 'DEPOSIT',
}

/**
 * The line types that describe the line instead of the goods, so they take no unit and no quantity.
 *
 * Derived from the enum by exclusion rather than listed, so a member added above lands in exactly one of the
 * two groups and cannot be forgotten here.
 */
export const NON_PRODUCT_LINE_TYPES: ReadonlySet<InvoiceLineType> = new Set(
    Object.values(InvoiceLineType).filter((lineType) => lineType !== InvoiceLineType.PRODUCT),
);

/** A line type that describes the line rather than the goods, and so takes no unit and no quantity. */
export type NonProductLineType = Exclude<InvoiceLineType, InvoiceLineType.PRODUCT>;

/**
 * Whether `lineType` describes the line rather than the goods on it. An absent value is a product line —
 * saying nothing is how a caller says "ordinary".
 *
 * A type guard rather than a `boolean`, which is what the narrower type above buys: inside the branch the
 * value cannot be `PRODUCT` or `undefined`, so the caller neither casts nor has to handle a case the check
 * already ruled out. A provider looking up the authority's code for one of these gets an answer for every
 * value the type admits.
 */
export function isNonProductLine(lineType: InvoiceLineType | undefined): lineType is NonProductLineType {
    return lineType !== undefined && NON_PRODUCT_LINE_TYPES.has(lineType);
}

import {asArray, text} from '../../../../../xml-node/xml-node.js';
import {cleanArcaDate} from '../common-helpers.js';

/**
 * Reading a reference table out of a parameter-method response, whichever web service answered.
 *
 * Every `FEParamGet*` and `FEXGetPARAM_*` table is the same shape — an id, usually a description, and a
 * validity range that is usually open-ended — wrapped in a result node under a repeated row element. The two
 * services agree on that shape and disagree on every name:
 *
 * | | WSFEv1 | WSFEXv1 |
 * | --- | --- | --- |
 * | result node | `ResultGet` | `FEXResultGet` |
 * | monedas | `Moneda{Id,Desc,FchDesde,FchHasta}` | `ClsFEXResponse_Mon{Mon_Id,Mon_Ds,Mon_vig_desde,Mon_vig_hasta}` |
 * | puntos de venta | `PtoVenta{Nro,EmisionTipo,Bloqueado,FchBaja}` | `ClsFEXResponse_PtoVenta{Pve_Nro,Pve_Bloqueado,Pve_FchBaja}` |
 * | países | `PaisTipo{Id,Desc}` | `ClsFEXResponse_DST_pais{DST_Codigo,DST_Ds}` |
 *
 * So the reader is shared and only the spelling is per-table. That is worth doing once rather than per
 * operation because the two rules in {@link catalogueRows} are the interesting part, and both had already
 * been reasoned out for the WSFEv1 tables — re-deriving them for each new WSFEX table is how they would come
 * to disagree.
 */
export interface CatalogueDialect {
    /** The element wrapping the rows — `ResultGet` on WSFEv1, `FEXResultGet` on WSFEXv1. */
    readonly resultNode: string;
    /** The repeated row element. It does not follow from the operation name, so every table states it. */
    readonly rowKey: string;
    readonly idField: string;
    /** Absent on the tables that carry no description of their own, such as points of sale. */
    readonly descField?: string;
    readonly validFromField?: string;
    readonly validToField?: string;
}

/** One reference-table row, normalized. `id` is always present; a row without a usable one is dropped. */
export interface CatalogueRow {
    readonly id: string;
    readonly description: string;
    readonly validFrom?: string;
    readonly validTo?: string;
    /** The raw row, for the columns a particular table carries and this shape does not name. */
    readonly raw: Record<string, unknown>;
}

/**
 * The rows of one reference table.
 *
 * Two behaviours carried over from the WSFEv1 readers this replaces, both load-bearing:
 *
 * - **An absent result element reads as `[]`**, via `asArray`. A CUIT with no registered points of sale is a
 *   legitimate empty answer, not a malformed one, so it must not raise.
 * - **A row with no usable id is dropped** rather than surfaced with an empty one. Production does send
 *   these: `FEXGetPARAM_MON` answers 52 rows of which three are a bare `xsi:nil="true"`. Surfaced, they
 *   become phantom catalogue entries that can only ever fail a later call — a currency a caller could offer
 *   in a picker and never use.
 */
export function catalogueRows(
    result: Record<string, unknown>,
    dialect: CatalogueDialect,
): Array<CatalogueRow> {
    const node = (result[dialect.resultNode] as Record<string, unknown> | undefined)?.[dialect.rowKey];
    return asArray(node)
        .map((row) => ({
            id: text(row[dialect.idField]) ?? '',
            description: (dialect.descField === undefined ? undefined : text(row[dialect.descField])) ?? '',
            validFrom:
                dialect.validFromField === undefined ? undefined : cleanArcaDate(row[dialect.validFromField]),
            validTo: dialect.validToField === undefined ? undefined : cleanArcaDate(row[dialect.validToField]),
            raw: row,
        }))
        .filter((row) => row.id !== '');
}

/** WSFEv1's `FEParamGetTiposMonedas`. */
export const WSFEV1_CURRENCIES: CatalogueDialect = {
    resultNode: 'ResultGet',
    rowKey: 'Moneda',
    idField: 'Id',
    descField: 'Desc',
    validFromField: 'FchDesde',
    validToField: 'FchHasta',
};

/** WSFEv1's `FEParamGetPtosVenta`. `EmisionTipo` and `Bloqueado` are read off `raw`. */
export const WSFEV1_POINTS_OF_SALE: CatalogueDialect = {
    resultNode: 'ResultGet',
    rowKey: 'PtoVenta',
    idField: 'Nro',
    validToField: 'FchBaja',
};

/** WSFEXv1's `FEXGetPARAM_PtoVenta`. No `EmisionTipo`: the register is FEEWS-only, so there is no kind. */
export const WSFEX_POINTS_OF_SALE: CatalogueDialect = {
    resultNode: 'FEXResultGet',
    rowKey: 'ClsFEXResponse_PtoVenta',
    idField: 'Pve_Nro',
    validToField: 'Pve_FchBaja',
};

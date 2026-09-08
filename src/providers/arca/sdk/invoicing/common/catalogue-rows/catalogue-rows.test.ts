import {describe, expect, it} from '@jest/globals';
import {
    catalogueRows,
    WSFEV1_CURRENCIES,
    WSFEV1_POINTS_OF_SALE,
    WSFEX_POINTS_OF_SALE,
    type CatalogueDialect,
} from './catalogue-rows.js';

/** WSFEXv1's `FEXGetPARAM_MON`, declared here because nothing needs it in `src` yet. */
const WSFEX_CURRENCIES: CatalogueDialect = {
    resultNode: 'FEXResultGet',
    rowKey: 'ClsFEXResponse_Mon',
    idField: 'Mon_Id',
    descField: 'Mon_Ds',
    validFromField: 'Mon_vig_desde',
    validToField: 'Mon_vig_hasta',
};

describe('catalogueRows', () => {
    it('reads a WSFEv1 currency table', () => {
        const rows = catalogueRows(
            {
                ResultGet: {
                    Moneda: [
                        {Id: 'PES', Desc: 'Pesos Argentinos', FchDesde: '20090403', FchHasta: 'NULL'},
                        {Id: 'DOL', Desc: 'Dólar Estadounidense', FchDesde: '20090403', FchHasta: 'NULL'},
                    ],
                },
            },
            WSFEV1_CURRENCIES,
        );

        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({id: 'PES', description: 'Pesos Argentinos', validFrom: '20090403'});
        // ARCA fills an unset date with the literal `NULL`, which must read as absent rather than travel on.
        expect(rows[0]?.validTo).toBeUndefined();
    });

    it('reads the same table off WSFEXv1, whose every element is spelled differently', () => {
        const rows = catalogueRows(
            {
                FEXResultGet: {
                    ClsFEXResponse_Mon: {
                        Mon_Id: 'DOL',
                        Mon_Ds: 'Dólar Estadounidense',
                        Mon_vig_desde: '20090403',
                        Mon_vig_hasta: 'NULL',
                    },
                },
            },
            WSFEX_CURRENCIES,
        );

        // A single occurrence parses as a bare object rather than an array; a table of one is still a table.
        expect(rows).toEqual([
            {
                id: 'DOL',
                description: 'Dólar Estadounidense',
                validFrom: '20090403',
                validTo: undefined,
                raw: expect.any(Object),
            },
        ]);
    });

    it('reads an absent result element as an empty table rather than raising', () => {
        // A CUIT with no registered points of sale is a legitimate answer, not a malformed one.
        expect(catalogueRows({}, WSFEV1_POINTS_OF_SALE)).toEqual([]);
        expect(catalogueRows({ResultGet: {}}, WSFEV1_POINTS_OF_SALE)).toEqual([]);
    });

    it('drops a row with no usable id', () => {
        // Production sends these: `FEXGetPARAM_MON` answers 52 rows of which three are a bare
        // `xsi:nil="true"`. Surfaced, they become catalogue entries that can only ever fail a later call.
        const rows = catalogueRows(
            {
                FEXResultGet: {
                    ClsFEXResponse_Mon: [
                        {Mon_Id: 'DOL', Mon_Ds: 'Dólar Estadounidense'},
                        {'@_nil': 'true'},
                        {Mon_Id: '', Mon_Ds: ''},
                        {Mon_Id: '   ', Mon_Ds: 'blank but present'},
                    ],
                },
            },
            WSFEX_CURRENCIES,
        );

        expect(rows.map((row) => row.id)).toEqual(['DOL']);
    });

    it('keeps the raw row for the columns the shared shape does not name', () => {
        const rows = catalogueRows(
            {ResultGet: {PtoVenta: {Nro: '3', EmisionTipo: 'CAE', Bloqueado: 'N', FchBaja: 'NULL'}}},
            WSFEV1_POINTS_OF_SALE,
        );

        expect(rows[0]?.id).toBe('3');
        expect(rows[0]?.raw.EmisionTipo).toBe('CAE');
        expect(rows[0]?.raw.Bloqueado).toBe('N');
    });

    it('leaves description empty for a table that carries none', () => {
        // WSFEX's point-of-sale register is FEEWS-only, so unlike WSFEv1's it has no issuance-kind column
        // and no description at all. An absent `descField` must not become the literal `"undefined"`.
        const rows = catalogueRows(
            {FEXResultGet: {ClsFEXResponse_PtoVenta: {Pve_Nro: '1', Pve_Bloqueado: 'N', Pve_FchBaja: 'NULL'}}},
            WSFEX_POINTS_OF_SALE,
        );

        expect(rows[0]).toMatchObject({id: '1', description: ''});
        expect(rows[0]?.validTo).toBeUndefined();
    });
});

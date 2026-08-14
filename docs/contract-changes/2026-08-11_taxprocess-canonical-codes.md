# Canonical taxprocess codes — stop keying maps by core's PKs

**Date:** 2026-08-11 · **Status:** ACTION REQUIRED (tax) · **Repos:** `webprocess-api` (core) → `tax-webprocess-api`
**Companion:** `webprocess-api/docs/tax-api/2026-08-11_taxprocess-canonical-codes.md` (core-side mirror)

## Why

Today core sends its **own database primary keys** for the three fiscal ids — `invoice.documentTypeId`,
`invoice.receiver.identificationTypeId`, `invoice.receiver.fiscalConditionId` — and this service mirrors core's
PK space in `src/providers/arca/code-maps.ts` (`Record<number,number>` keyed by core PK). That couples the tax
service to core's DB ids and is brittle for **document types**, where a core PK ≠ its code (e.g. PK `17`
"FACTURA DE EXPORTACIÓN" → CbteTipo `19`) and where two disjoint core id-sets (legacy `1–213` and the purchase
twins `1xxx`) both map to the same CbteTipo.

Core is moving to send a **canonical numeric code** for each of the three instead of its PK. The canonical code
is provider-agnostic (this service maps it to each provider's real code). For ARCA the canonical codes equal
ARCA's own codes, so the maps become **identity** and the two document-type id-sets collapse to one entry per
code. On core's side these live in new columns: `common.document_type.fiscal_code` (renamed from `arca_code`),
`common.fiscal_condition.fiscal_code`, `common.identification_type.fiscal_code` (renamed from `iso_code`).

This service has no DB, so the canonical codes should be expressed as **in-code enums** and the maps re-keyed by
them.

## Files to change (tax service)

- `src/http/dto/invoice.dto.ts` — `NeutralInvoiceDto` + `InvoiceReceiverDto` field renames (below).
- `src/providers/provider.ts` — `NeutralInvoice` runtime type (`documentTypeId`/`identificationTypeId`/
  `fiscalConditionId` → `*Code`).
- `src/providers/arca/code-maps.ts` — define the three enums; re-key the three maps by canonical code.
- `src/providers/arca/ar-invoice.mapper.ts` — `toCbteTipo(invoice.documentTypeCode)` etc. (~L108/110/121).
- `src/providers/arca/arca.provider.ts` — `toCbteTipo(invoice.documentTypeCode)` on query/last-authorized/
  recovery (~L167/205/227).
- `docs/CONTRACT.md` — §2 field glossary + §5 "Neutral ids the caller supplies".

## Required changes

### 1. Wire field renames (all three endpoints)

`whitelist:true, forbidNonWhitelisted:true` makes these renames strictly breaking — coordinate the cutover.

| old (core PK) | new (canonical code) |
| --- | --- |
| `invoice.documentTypeId` | `invoice.documentTypeCode` |
| `invoice.receiver.identificationTypeId` | `invoice.receiver.identificationTypeCode` |
| `invoice.receiver.fiscalConditionId` | `invoice.receiver.fiscalConditionCode` |

Also `POST /invoices/last-authorized` and `POST /invoices/query`: `documentTypeId` → `documentTypeCode`
(`{entity, pointOfSaleNumber, documentTypeCode[, voucherNumber]}`). All remain positive integers.

### 2. Define shared, provider-agnostic enums

One enumeration per domain (not per provider). Suggested (numeric enums; the member value **is** the canonical
code):

```ts
// canonical taxprocess codes — provider-agnostic; each provider maps them to its real codes.
export enum TaxProcessDocumentTypeCode {
    FACTURA_A = 1, NOTA_DEBITO_A = 2, NOTA_CREDITO_A = 3, RECIBO_A = 4, NOTA_VENTA_A = 5,
    FACTURA_B = 6, NOTA_DEBITO_B = 7, NOTA_CREDITO_B = 8, RECIBO_B = 9, NOTA_VENTA_B = 10,
    FACTURA_C = 11, NOTA_DEBITO_C = 12, NOTA_CREDITO_C = 13, DOCUMENTO_ADUANERO = 14, RECIBO_C = 15,
    NOTA_VENTA_CONTADO_C = 16, FACTURA_EXPORTACION = 19, NOTA_DEBITO_EXTERIOR = 20, NOTA_CREDITO_EXTERIOR = 21,
    FACTURA_PERMISO_EXPORTACION_SIMPLIFICADO = 22, COMPRA_BIENES_USADOS = 30,
    COMPROBANTE_A_3419 = 34, COMPROBANTE_B_3419 = 35, COMPROBANTE_C_3419 = 36,
    NOTA_DEBITO_3419 = 37, NOTA_CREDITO_3419 = 38, OTROS_A_3419 = 39, OTROS_B_3419 = 40, OTROS_C_3419 = 41,
    CUENTA_VENTA_LIQUIDO_A = 60, CUENTA_VENTA_LIQUIDO_B = 61, CUENTA_VENTA_LIQUIDO_C = 62,
    LIQUIDACION_A = 63, LIQUIDACION_B = 64, LIQUIDACION_C = 65, CIERRE_ZETA = 80,
    TIQUE_FACTURA_A = 81, TIQUE_FACTURA_B = 82, FACTURA_SERVICIOS_PUBLICOS = 91,
    AJUSTE_INCREMENTA_DEBITO = 92, AJUSTE_DISMINUYE_DEBITO = 93, AJUSTE_INCREMENTA_CREDITO = 94,
    AJUSTE_DISMINUYE_CREDITO = 95,
    FACTURA_M = 51, NOTA_DEBITO_M = 52, NOTA_CREDITO_M = 53, RECIBO_M = 54, NOTA_VENTA_M = 55,
    FCE_FACTURA_A = 201, FCE_NOTA_DEBITO_A = 202, FCE_NOTA_CREDITO_A = 203,
    FCE_FACTURA_B = 206, FCE_NOTA_DEBITO_B = 207, FCE_NOTA_CREDITO_B = 208,
    FCE_FACTURA_C = 211, FCE_NOTA_DEBITO_C = 212, FCE_NOTA_CREDITO_C = 213,
}

export enum TaxProcessIdentificationTypeCode {
    CUIT = 80, CUIL = 86, CDI = 87, LE = 89, LC = 90, CI_EXTRANJERA = 91, PASAPORTE = 94, DNI = 96,
    SIN_IDENTIFICAR = 99,
}

export enum TaxProcessFiscalConditionCode {
    RESPONSABLE_INSCRIPTO = 1, SUJETO_EXENTO = 4, CONSUMIDOR_FINAL = 5, MONOTRIBUTO = 6,
    NO_CATEGORIZADO = 7, PROVEEDOR_EXTERIOR = 8, CLIENTE_EXTERIOR = 9, IVA_LIBERADO = 10,
    MONOTRIBUTISTA_SOCIAL = 13, IVA_NO_ALCANZADO = 15, MONOTRIBUTO_INDEP_PROMOVIDO = 16,
}
```

The document-type list above is the authoritative canonical set (core's `common.document_type.fiscal_code`
values). Member **names** are non-normative (yours to choose); only the **values** are the contract.

### 3. Re-key the ARCA maps by canonical code (not core PK)

In `code-maps.ts`, the three `Record<number,number>` maps become keyed by the canonical code. For ARCA every
entry is **identity** (canonical code == ARCA code), so the maps collapse to identities and the legacy-vs-`1xxx`
document-type duplication disappears:

- `toCbteTipo(code)` → `code` is already the CbteTipo (validate membership in `TaxProcessDocumentTypeCode`;
  unknown → the existing `UNMAPPED_ID`/validation error, rename at will).
- `toDocTipo(code)` → `code` is already the DocTipo.
- `toCondicionIvaReceptorId(code)` → `code` is already the CondicionIVAReceptorId.

Keep these as functions (the per-provider extension point): a future non-ARCA provider will supply a real
non-identity map from the same canonical enum to its own codes.

### 4. Docs

Update `docs/CONTRACT.md` §2 (the field glossary: `documentTypeCode → CbteTipo`,
`identificationTypeCode → DocTipo`, `fiscalConditionCode → CondicionIVAReceptorId`) and §5 (rename the
"neutral ids" to "canonical codes"; note they are no longer core PKs).

## Verification (interop gate)

Run the tax service on :4101, point core at it, and confirm `authorize` is accepted (no 400) with the new
`*Code` fields; a homologación authorize returns a CAE. Confirm a purchase-twin document type (core PK `1001`)
and its sales sibling (core PK `1`) both send `documentTypeCode: 1` and authorize identically. Grep the tax
service for residual PK-keyed lookups.

## Reference

- Canonical code source (core): `common.document_type.fiscal_code`, `common.identification_type.fiscal_code`,
  `common.fiscal_condition.fiscal_code` (all `SMALLINT`).
- Prior neutral-wire alignment: `docs/contract-changes/2026-08-10_core-wire-alignment.md`.
- Field glossary: `docs/CONTRACT.md`.

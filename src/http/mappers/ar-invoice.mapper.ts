import {NotImplementedError, type CommonInvoiceRequest} from '../../arca/index.js';
import type {NeutralInvoiceDto} from '../dto/neutral-invoice.dto.js';

/**
 * Translates the neutral canonical invoice document into the SDK's ARCA-specific
 * {@link CommonInvoiceRequest}. This is where every Argentina-specific rule lives.
 *
 * TODO (Phase-2 next pass): port the AR translation from
 * `webprocess-api/src/app/services/protected/transactions/electronic-invoice.service.ts:43-203`:
 *   - `ISO_TO_ARCA_CURRENCY` (ISO-4217 → `MonId`)
 *   - voucher type (`CbteTipo`) from `documentClass` semantics
 *   - receiver IVA condition (`CondicionIVAReceptorId`) from the neutral fiscal-condition code
 *   - VAT-subtotal grouping via the SDK's `calculateTotals`
 *   - perceptions → `Tributos[]`
 *   - RG-4892 QR via the SDK's `buildArcaQrUrl`
 * These need the semantic→ARCA lookup tables (voucher class, IVA condition) that today come from the
 * core API's DB catalogs, re-homed here as static maps.
 */
export function mapNeutralInvoiceToArca(_invoice: NeutralInvoiceDto): CommonInvoiceRequest {
    throw new NotImplementedError('ar-invoice.mapper.mapNeutralInvoiceToArca');
}

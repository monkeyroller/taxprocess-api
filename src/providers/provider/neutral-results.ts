/**
 * The neutral result aliases. Each names the result DTO the HTTP layer already declares, so a provider and a
 * controller speak the same shape without the provider layer re-declaring it. The imports are type-only,
 * which keeps the relationship with `http/dto` compile-time only in both directions.
 */
import type {
    LastAuthorizedResultDto,
    NeutralAuthorizationResultDto,
} from '../../http/dto/authorization-result.dto.js';
import type {AuthorityStatusResultDto} from '../../http/dto/authority-status-result.dto.js';
import type {NextNumbersResultDto} from '../../http/dto/next-numbers-result.dto.js';
import type {PointsOfSaleResultDto} from '../../http/dto/points-of-sale-result.dto.js';
import type {CurrencyRatesResultDto} from '../../http/dto/currency-rates-result.dto.js';
import type {CreditInvoiceObligationResultDto} from '../../http/dto/credit-invoice-obligation-result.dto.js';
import type {TaxpayerResultDto} from '../../http/dto/taxpayer-result.dto.js';

/** The neutral authorization result (reuses the country-agnostic result DTO). */
export type TaxAuthorizationResult = NeutralAuthorizationResultDto;

/** The authority's last authorized voucher number for one (point of sale, document type). */
export type LastAuthorizedResult = LastAuthorizedResultDto;

/** The highest idempotency key the authority has seen for this issuer, where it keeps one. */

/** Neutral taxpayer-registry lookup result (reuses the country-agnostic result DTO). */
export type TaxpayerResult = TaxpayerResultDto;

/** Whether a buyer must be sent a Factura de Crédito Electrónica, and from what amount. */
export type CreditInvoiceObligationResult = CreditInvoiceObligationResultDto;

/** Neutral list of the entity's registered points of sale (reuses the country-agnostic result DTO). */
export type PointsOfSaleResult = PointsOfSaleResultDto;

/** Neutral batch of next-expected voucher numbers, one per requested code (reuses the country-agnostic DTO). */
export type NextNumbersResult = NextNumbersResultDto;

/** Neutral batch of published exchange rates + accepted bands (reuses the country-agnostic result DTO). */
export type CurrencyRatesResult = CurrencyRatesResultDto;

/** Neutral authority health result (reuses the country-agnostic result DTO). */
export type AuthorityStatusResult = AuthorityStatusResultDto;

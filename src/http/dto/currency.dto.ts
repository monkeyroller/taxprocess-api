import {ArrayMinSize, IsArray, IsIn, IsOptional, IsString, Length, MinLength} from 'class-validator';
import {GENERIC_ENVIRONMENTS, type GenericEnvironment} from '../../providers/provider/environment.js';
import {IsAuthorityDate} from './authority-date/authority-date.js';
import {WEB_SERVICES, type WebService} from '../../providers/provider/web-service.js';

/**
 * Body for `POST /currencies/rates`. No issuer or credentials block, for the same reason the taxpayer lookup
 * has none: an exchange rate is a property of the entity, currency and day alone, so it is read under this
 * service's own delegate identity. That is a precondition rather than a convenience — a caller caches these
 * centrally for every tenant, and populating a platform-wide catalogue from one tenant's certificate would
 * break the day that certificate lapsed.
 */
export class CurrencyRatesRequestDto {
    /** Selects the provider that handles the request. E.g. `"ARCA"` (Argentina/AFIP). */
    @IsString()
    @MinLength(1)
    entityCode!: string;

    /** Generic environment; the AR provider maps it to `homologacion` (testing) / `produccion` (production). */
    @IsIn(GENERIC_ENVIRONMENTS)
    environment!: GenericEnvironment;

    /**
     * Canonical currency codes (AR: each a `MonId`). Omit for the entity's whole table — an authority
     * publishes all its rates at once, so that is the shape of both a daily sync and the answer a caller
     * caches, where enumerating the codes it happens to know would miss any its seed has drifted behind on.
     *
     * The whole table is every currency this service supports: the authority's catalogue intersected with
     * the codes an invoice may name, so a rate is never offered for a currency `/invoices/authorize` would
     * refuse. Naming such a code explicitly returns it under `unavailable` instead.
     *
     * `@Length(1, 8)` rather than a fixed three, ARCA itself typing `MonId` as `String(8)` on the cotización
     * response against `String(3)` in the catalogue. An empty array is refused rather than read as the whole
     * table: a caller sending `[]` has a bug, not an intention.
     */
    @IsOptional()
    @IsArray()
    @ArrayMinSize(1)
    @IsString({each: true})
    @Length(1, 8, {each: true})
    currencyCodes?: Array<string>;

    /**
     * The day to quote for; omit for the authority's latest publication. A calendar day in the authority's
     * own calendar, or an instant carrying a UTC offset. The answer's `rateDate` may be earlier than the day
     * asked for, a rate belonging to the last published business day, so read the day off the answer.
     */
    @IsOptional()
    @IsAuthorityDate()
    date?: string;

    /**
     * Which of the entity's web services to price for (its `configuration.webService`). Omitted is the
     * ordinary invoicing service.
     *
     * A bare selector rather than the `configuration` object, so the absence of an issuer block above stays
     * true: this still resolves under the service's own delegated identity, and no tenant credential is
     * involved.
     *
     * It changes the *set*, not the numbers. Measured against production on 2026-09-04, AR's two services
     * publish identical rates for every currency priced that day — but the export service prices only the
     * subset an export voucher may name (27 of 49 catalogued codes on that day), which is a rule about
     * eligibility rather than about price. A code the requested service has no rate for comes back under
     * `unavailable`.
     */
    @IsOptional()
    @IsIn(WEB_SERVICES)
    webService?: WebService;
}

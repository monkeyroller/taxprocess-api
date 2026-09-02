import {ArrayMinSize, IsArray, IsIn, IsOptional, IsString, Length, MinLength} from 'class-validator';
import {GENERIC_ENVIRONMENTS, type GenericEnvironment} from '../../providers/provider/environment.js';
import {IsAuthorityDate} from './authority-date/authority-date.js';

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
}

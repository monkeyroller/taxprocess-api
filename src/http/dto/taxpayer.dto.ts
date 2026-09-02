import {IsIn, IsInt, IsString, MinLength} from 'class-validator';
import {GENERIC_ENVIRONMENTS, type GenericEnvironment} from '../../providers/provider/environment.js';

/**
 * Body for `POST /taxpayers/lookup`. Carries the same identification pair as an invoice receiver, which is
 * both what the caller has and what selects the registry to ask: a tax id is looked up directly, while an
 * identity document has to be resolved to the tax ids issued for it first. The provider owns that routing,
 * so the wire never names an authority service.
 *
 * No issuer or credentials block: registry lookups run under this service's own delegated identity.
 */
export class TaxpayerLookupRequestDto {
    /** Selects the provider that handles the request. E.g. `"ARCA"` (Argentina/AFIP). */
    @IsString()
    @MinLength(1)
    entityCode!: string;

    /** Generic environment; the AR provider maps it to `homologacion` (testing) / `produccion` (production). */
    @IsIn(GENERIC_ENVIRONMENTS)
    environment!: GenericEnvironment;

    /**
     * Canonical identification-type code (AR: 80 CUIT, 86 CUIL, 87 CDI, 96 DNI, 89 LE, 90 LC). Validated as
     * an integer here; whether the entity's registry can answer for it is the provider's call, and an
     * unroutable type is a `400`.
     */
    @IsInt()
    identificationTypeCode!: number;

    /** The identifier to look up, digits as a string. */
    @IsString()
    @MinLength(1)
    identificationNumber!: string;
}

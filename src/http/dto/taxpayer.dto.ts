import {IsIn, IsInt, IsString, MinLength} from 'class-validator';
import {GENERIC_ENVIRONMENTS, type GenericEnvironment} from '../../providers/provider.js';

/**
 * Body for `POST /taxpayers/lookup`.
 *
 * Carries the same identification pair as an invoice receiver — a canonical `identificationTypeCode`
 * plus the number — because that is exactly the information the caller has, and it is what selects the
 * registry to ask: a tax id is looked up directly, an identity document has to be resolved to the tax
 * ids issued for it first. The provider owns that routing (AR: `toPadronService`), so the wire never
 * names an authority service.
 *
 * There is no issuer/credentials block: registry lookups are made under this service's own delegated
 * identity, so they never trigger the `CREDENTIALS_REQUIRED` handshake.
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
     * Canonical identification-type code (AR: 80=CUIT, 86=CUIL, 87=CDI, 96=DNI, 89=LE, 90=LC). Validated
     * as an integer here; whether the entity's registry can answer for it is the provider's call — an
     * unroutable type is a `400` with `details.code: "UNSUPPORTED_IDENTIFICATION_TYPE"`.
     */
    @IsInt()
    identificationTypeCode!: number;

    /** The identifier to look up, digits as a string. */
    @IsString()
    @MinLength(1)
    identificationNumber!: string;
}

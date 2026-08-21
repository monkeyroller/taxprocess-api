import {Type} from 'class-transformer';
import {IsBoolean, IsIn, IsOptional, IsString, MinLength, ValidateNested} from 'class-validator';
import {GENERIC_ENVIRONMENTS, type GenericEnvironment} from '../../providers/provider.js';

/**
 * Issuer credentials, attached ONLY when core re-sends after a `CREDENTIALS_REQUIRED` (never on a first
 * request). The certificate + already-decrypted private key with which this service logs in to the tax
 * authority; held only transiently in memory to mint a ticket, never persisted.
 */
export class IssuerCredentialsDto {
    @IsString()
    @MinLength(1)
    certPem!: string;

    @IsString()
    @MinLength(1)
    keyPem!: string;
}

/**
 * The entity/issuer block on every issuing call. `entityCode` selects the provider; `issuerTaxId` is the
 * issuing party's canonical tax identifier (its type is implied by `entityCode`). First requests carry
 * identity only; `credentials` appears only when core re-sends after a `CREDENTIALS_REQUIRED`.
 */
export class EntityAuthDto {
    @IsString()
    @MinLength(1)
    /** Selects the provider that handles the request. E.g. `"ARCA"` (Argentina/AFIP). */
    entityCode!: string;

    /** Issuing taxpayer's canonical tax id, as a string. **AR: the CUIT** (11 digits), e.g. `"20123456789"`. */
    @IsString()
    @MinLength(1)
    issuerTaxId!: string;

    /** Generic environment; the AR provider maps it to `homologacion` (testing) / `produccion` (production). */
    @IsIn(GENERIC_ENVIRONMENTS)
    environment!: GenericEnvironment;

    @IsOptional()
    @ValidateNested()
    @Type(() => IssuerCredentialsDto)
    credentials?: IssuerCredentialsDto;

    /**
     * Delegated authorization. When `true`, `issuerTaxId` is the represented taxpayer and this service
     * signs with its own platform certificate — `credentials` is ignored and no `CREDENTIALS_REQUIRED`
     * handshake occurs. Omit (or `false`) for the tenant-certificate flow.
     */
    @IsOptional()
    @IsBoolean()
    delegated?: boolean;
}

/** Body for `POST /authority/status` — dispatches by `entityCode`; needs only the environment (no ticket). */
export class AuthorityStatusDto {
    @IsString()
    @MinLength(1)
    entityCode!: string;

    @IsIn(GENERIC_ENVIRONMENTS)
    environment!: GenericEnvironment;
}

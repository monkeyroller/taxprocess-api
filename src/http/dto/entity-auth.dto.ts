import {Type} from 'class-transformer';
import {IsBoolean, IsIn, IsOptional, IsString, MinLength, ValidateNested} from 'class-validator';
import {GENERIC_ENVIRONMENTS, type GenericEnvironment} from '../../providers/provider/environment.js';

/**
 * Issuer credentials, attached only when core re-sends after a `CREDENTIALS_REQUIRED`. The certificate and
 * already-decrypted private key this service logs in with; held in memory to mint a ticket, never persisted.
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
 * The entity/issuer block on every issuing call. `entityCode` selects the provider and `issuerTaxId` is the
 * issuing party's canonical tax identifier, its type implied by `entityCode`.
 */
export class EntityAuthDto {
    @IsString()
    @MinLength(1)
    /** Selects the provider that handles the request. E.g. `"ARCA"` (Argentina/AFIP). */
    entityCode!: string;

    /** Issuing taxpayer's canonical tax id, as a string. AR: the 11-digit CUIT. */
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
     * Delegated authorization. When `true`, `issuerTaxId` is the represented taxpayer and this service signs
     * with its own platform certificate, so `credentials` is ignored and no handshake occurs. Omit for the
     * tenant-certificate flow.
     */
    @IsOptional()
    @IsBoolean()
    delegated?: boolean;
}

/** Body for `POST /authority/status`. Dispatches by `entityCode` and needs no ticket. */
export class AuthorityStatusDto {
    @IsString()
    @MinLength(1)
    entityCode!: string;

    @IsIn(GENERIC_ENVIRONMENTS)
    environment!: GenericEnvironment;
}

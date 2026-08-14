import {Type} from 'class-transformer';
import {IsIn, IsNotEmpty, IsObject, IsString, ValidateNested} from 'class-validator';
import {GENERIC_ENVIRONMENTS, type GenericEnvironment} from '../../providers/provider.js';
import {IssuerCredentialsDto} from './entity-auth.dto.js';

/**
 * Body for `POST /entities/:entityCode/credentials/validate` (H3). `configuration` is the entity's
 * non-secret settings blob and `credentials` the secret bundle; the provider enforces their per-entity
 * shape (the H5 JSON Schemas). `entityCode` comes from the URL, not the body.
 */
export class ValidateCredentialsRequestDto {
    @IsIn(GENERIC_ENVIRONMENTS)
    environment!: GenericEnvironment;

    /**
     * Free-form per-entity settings blob; the provider validates its contents. For ARCA the credential
     * validation reads nothing from here — the issuer identity it checks the certificate against comes from
     * `expectedTaxId`, not from this blob.
     */
    @IsObject()
    configuration!: Record<string, unknown>;

    @ValidateNested()
    @Type(() => IssuerCredentialsDto)
    credentials!: IssuerCredentialsDto;

    /**
     * The owning company's registered tax id (AR: CUIT) the certificate must belong to — sourced from
     * core's `org.company.identificationNumber`. Any formatting is accepted (`"20111111112"` or
     * `"20-11111111-2"`); the provider canonicalizes it to 11 digits before matching. Required: core always
     * sends it, and the provider enforces the taxpayer match against it.
     */
    @IsString()
    @IsNotEmpty()
    expectedTaxId!: string;
}

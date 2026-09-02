import {Type} from 'class-transformer';
import {IsDefined, IsIn, IsNotEmpty, IsObject, IsString, ValidateNested} from 'class-validator';
import {GENERIC_ENVIRONMENTS, type GenericEnvironment} from '../../providers/provider/environment.js';
import {IssuerCredentialsDto} from './entity-auth.dto.js';

/**
 * Body for `POST /entities/:entityCode/credentials/validate`. `configuration` is the entity's non-secret
 * settings blob and `credentials` the secret bundle; the provider enforces their per-entity shape.
 * `entityCode` comes from the URL rather than the body.
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

    // `@IsDefined` alongside `@ValidateNested`: nested validation alone passes a missing object, and the
    // provider then reads `credentials.certPem` off `undefined` — a `500` for a body that left it out.
    @IsDefined()
    @ValidateNested()
    @Type(() => IssuerCredentialsDto)
    credentials!: IssuerCredentialsDto;

    /**
     * The owning company's registered tax id (AR: CUIT) the certificate must belong to. Any formatting is
     * accepted; the provider canonicalizes it before matching.
     */
    @IsString()
    @IsNotEmpty()
    expectedTaxId!: string;
}

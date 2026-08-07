import {Type} from 'class-transformer';
import {IsIn, IsObject, ValidateNested} from 'class-validator';
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

    /** Free-form per-entity settings blob; the provider validates its contents. */
    @IsObject()
    configuration!: Record<string, unknown>;

    @ValidateNested()
    @Type(() => IssuerCredentialsDto)
    credentials!: IssuerCredentialsDto;
}

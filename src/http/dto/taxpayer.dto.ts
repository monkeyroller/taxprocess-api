import {Type} from 'class-transformer';
import {IsIn, IsOptional, IsString, MinLength, ValidateNested} from 'class-validator';
import type {RegistryLevel} from '../../providers/arca/sdk/index.js';
import {EntityAuthDto} from './entity-auth.dto.js';

/** ARCA padrón levels, as a runtime tuple for `@IsIn` and the SDK's `RegistryLevel` union. */
export const REGISTRY_LEVELS = ['A4', 'A5', 'A10', 'A13'] as const;

/** Body for `POST /taxpayers/lookup`. */
export class TaxpayerLookupRequestDto {
    @ValidateNested()
    @Type(() => EntityAuthDto)
    entity!: EntityAuthDto;

    /** The subject tax identifier to look up (digits as a string). */
    @IsString()
    @MinLength(1)
    taxpayerId!: string;

    /** Registry level (defaults to `A5`). Each level needs its own delegated permission + WSAA ticket. */
    @IsOptional()
    @IsIn(REGISTRY_LEVELS)
    level?: RegistryLevel;
}

import {Type} from 'class-transformer';
import {IsIn, IsInt, IsOptional, IsPositive, ValidateNested} from 'class-validator';
import type {RegistryLevel} from '../../arca/index.js';
import {ArgentinaIssuerDto} from './issuer-auth.dto.js';

/** ARCA padrón levels, as a runtime tuple for `@IsIn` and the SDK's `RegistryLevel` union. */
export const REGISTRY_LEVELS = ['A4', 'A5', 'A10', 'A13'] as const;

/** Body for `POST /taxpayers/lookup`. */
export class TaxpayerLookupRequestDto {
    @ValidateNested()
    @Type(() => ArgentinaIssuerDto)
    issuer!: ArgentinaIssuerDto;

    /** The CUIT/CUIL to look up. */
    @IsInt()
    @IsPositive()
    taxpayerId!: number;

    /** Padrón level (defaults to `A5`). Each level needs its own delegated permission + WSAA ticket. */
    @IsOptional()
    @IsIn(REGISTRY_LEVELS)
    level?: RegistryLevel;
}

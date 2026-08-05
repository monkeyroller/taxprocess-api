import {Type} from 'class-transformer';
import {Equals, IsIn, IsInt, IsOptional, IsPositive, IsString, MinLength, ValidateNested} from 'class-validator';
import type {ArcaEnvironment} from '../../arca/index.js';

/** ARCA environments, as a runtime tuple for `@IsIn` and a compile-time union alias. */
export const ARCA_ENVIRONMENTS = ['homologacion', 'produccion'] as const;

/**
 * A WSAA ticket minted by core, attached ONLY on a renewal re-send (never on a first request). It is
 * short-lived (~12h) auth material — not the private key.
 */
export class InjectedTicketDto {
    @IsString()
    @MinLength(1)
    token!: string;

    @IsString()
    @MinLength(1)
    sign!: string;

    /** ISO-8601 expiration timestamp from the WSAA ticket. */
    @IsString()
    @MinLength(1)
    expiration!: string;
}

/**
 * Issuer identity for Argentina — the `AR` arm of the country-agnostic issuer-auth union. Carries no
 * key/cert; `ticket` appears only when core re-sends after a `TICKET_REQUIRED`.
 */
export class ArgentinaIssuerDto {
    @Equals('AR')
    countryCode!: 'AR';

    /** Issuing CUIT (digits only). */
    @IsInt()
    @IsPositive()
    cuit!: number;

    @IsIn(ARCA_ENVIRONMENTS)
    environment!: ArcaEnvironment;

    @IsOptional()
    @ValidateNested()
    @Type(() => InjectedTicketDto)
    ticket?: InjectedTicketDto;
}

/** Body for `POST /authority/status` — the health check needs only the environment (no ticket). */
export class AuthorityStatusDto {
    @IsIn(ARCA_ENVIRONMENTS)
    environment!: ArcaEnvironment;
}

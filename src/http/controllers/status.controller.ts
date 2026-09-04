import type {Response} from 'express';
import {Body, Get, JsonController, Post, Res} from 'routing-controllers';
import {getProvider} from '../../providers/registry/registry.js';
import {AuthorityStatusDto} from '../dto/entity-auth.dto.js';
import type {AuthorityStatusResultDto} from '../dto/authority-status-result.dto.js';
import type {HealthResultDto} from '../dto/health-result.dto.js';
import {sendError} from '../error-mapper/error-mapper.js';

/**
 * Liveness and authority health. `POST /authority/status` runs the entity's own health check without a
 * ticket or credentials, proving the service reaches the authority for the requested environment.
 */
@JsonController()
export class StatusController {
    /** A pure liveness probe; no provider is consulted. */
    @Get('/health')
    health(): HealthResultDto {
        return {
            status: 'ok',
            service: 'taxprocess-api',
            uptimeSeconds: Math.floor(process.uptime()),
        };
    }

    /** Dispatches on `entityCode` and runs the entity's health check. */
    @Post('/authority/status')
    async authorityStatus(@Body() body: AuthorityStatusDto, @Res() res: Response): Promise<Response> {
        try {
            const status: AuthorityStatusResultDto = await getProvider(body.entityCode).authorityStatus(
                body.environment,
            );
            return res.json(status);
        } catch (err) {
            return sendError(res, err);
        }
    }
}

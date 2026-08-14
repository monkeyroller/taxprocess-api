import type {Response} from 'express';
import {Body, Get, JsonController, Post, Res} from 'routing-controllers';
import {getProvider} from '../../providers/registry.js';
import {AuthorityStatusDto} from '../dto/entity-auth.dto.js';
import {sendError} from '../error-mapper.js';

interface HealthResponse {
    readonly status: 'ok';
    readonly service: string;
    readonly uptimeSeconds: number;
}

/**
 * Liveness + authority health. `GET /health` is a pure liveness probe (no provider). `POST
 * /authority/status` dispatches on `entityCode` and runs the entity's health check — no ticket, no
 * credentials — proving the service reaches the authority for the requested environment.
 */
@JsonController()
export class StatusController {
    /** `GET /health` is a pure liveness probe (no provider). */
    @Get('/health')
    health(): HealthResponse {
        return {
            status: 'ok',
            service: 'taxprocess-api',
            uptimeSeconds: Math.floor(process.uptime()),
        };
    }

    /** `POST /authority/status` dispatches on `entityCode` and runs the entity's health check. */
    @Post('/authority/status')
    async authorityStatus(@Body() body: AuthorityStatusDto, @Res() res: Response): Promise<Response> {
        try {
            const status = await getProvider(body.entityCode).authorityStatus(body.environment);
            return res.json(status);
        } catch (err) {
            return sendError(res, err);
        }
    }
}

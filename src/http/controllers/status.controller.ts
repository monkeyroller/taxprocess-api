import type {Response} from 'express';
import {Body, Get, JsonController, Post, Res} from 'routing-controllers';
import {CommonInvoiceService, SoapClient} from '../../arca/index.js';
import {AuthorityStatusDto} from '../dto/issuer-auth.dto.js';
import {sendError} from '../error-mapper.js';

interface HealthResponse {
    readonly status: 'ok';
    readonly service: string;
    readonly uptimeSeconds: number;
}

/**
 * Liveness + authority health. `GET /health` is a pure liveness probe (no SDK). `POST /authority/status`
 * runs WSFEv1 `FEDummy` through the real SDK — no ticket, no credentials — proving the service reaches
 * ARCA for the requested environment.
 */
@JsonController()
export class StatusController {
    @Get('/health')
    health(): HealthResponse {
        return {
            status: 'ok',
            service: 'arca-webprocess-api',
            uptimeSeconds: Math.floor(process.uptime()),
        };
    }

    @Post('/authority/status')
    async authorityStatus(@Body() body: AuthorityStatusDto, @Res() res: Response): Promise<Response> {
        try {
            const service = new CommonInvoiceService(new SoapClient(), body.environment);
            const status = await service.getServerStatus();
            return res.json(status);
        } catch (err) {
            return sendError(res, err);
        }
    }
}

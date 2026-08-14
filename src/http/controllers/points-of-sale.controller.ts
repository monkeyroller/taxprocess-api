import type {Response} from 'express';
import {Body, JsonController, Post, Res} from 'routing-controllers';
import {getProvider} from '../../providers/registry.js';
import type {PointsOfSaleResultDto} from '../dto/neutral-result.dto.js';
import {PointsOfSaleRequestDto} from '../dto/invoice.dto.js';
import {sendError} from '../error-mapper.js';

/**
 * Points-of-sale enumeration. Dispatches on `entityCode` to the provider, which resolves the
 * entity's ticket — a cache miss with no credentials throws `CredentialsRequiredError` →
 * `409 CREDENTIALS_REQUIRED`, prompting core to re-send the same request with the issuer's credentials.
 */
@JsonController('/points-of-sale')
export class PointsOfSaleController {
    @Post()
    async list(@Body() body: PointsOfSaleRequestDto, @Res() res: Response): Promise<Response> {
        try {
            const {entity} = body;
            const result: PointsOfSaleResultDto = await getProvider(entity.entityCode).pointsOfSale(entity);
            return res.json(result);
        } catch (err) {
            return sendError(res, err);
        }
    }
}

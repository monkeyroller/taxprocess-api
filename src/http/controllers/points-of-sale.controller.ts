import type {Response} from 'express';
import {Body, JsonController, Post, Res} from 'routing-controllers';
import {getProvider} from '../../providers/registry/registry.js';
import type {PointsOfSaleResultDto} from '../dto/points-of-sale-result.dto.js';
import {PointsOfSaleRequestDto} from '../dto/points-of-sale-request.dto.js';
import {sendError} from '../error-mapper/error-mapper.js';

/**
 * Points-of-sale enumeration. Dispatches on `entityCode` to the provider, which resolves the entity's ticket
 * — a cache miss with no credentials is a `409`, prompting core to re-send with the issuer's credentials.
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

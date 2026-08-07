import type {Response} from 'express';
import {Body, JsonController, Post, Res} from 'routing-controllers';
import {getProvider} from '../../providers/registry.js';
import type {TaxpayerResultDto} from '../dto/neutral-result.dto.js';
import {TaxpayerLookupRequestDto} from '../dto/taxpayer.dto.js';
import {sendError} from '../error-mapper.js';

/**
 * Neutral taxpayer-registry lookup. Dispatches on `entityCode`; the provider resolves the level-specific
 * ticket (`409 CREDENTIALS_REQUIRED` on a miss) and calls the tax authority.
 *
 * NOTE: the ARCA SDK's padrón `parseTaxpayer` is still a SEED for every level, so this currently throws
 * `NotImplementedError` (→ `501`) after the SOAP call. It returns real data once the SDK level is
 * implemented; no change is needed here.
 */
@JsonController('/taxpayers')
export class TaxpayersController {
    @Post('/lookup')
    async lookup(@Body() body: TaxpayerLookupRequestDto, @Res() res: Response): Promise<Response> {
        try {
            const {entity} = body;
            const result: TaxpayerResultDto = await getProvider(entity.entityCode).lookupTaxpayer(
                entity,
                body.taxpayerId,
                body.level,
            );
            return res.json(result);
        } catch (err) {
            return sendError(res, err);
        }
    }
}

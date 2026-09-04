import type {Response} from 'express';
import {Body, JsonController, Post, Res} from 'routing-controllers';
import {getProvider} from '../../providers/registry/registry.js';
import type {TaxpayerResultDto} from '../dto/taxpayer-result.dto.js';
import {TaxpayerLookupRequestDto} from '../dto/taxpayer.dto.js';
import {sendError} from '../error-mapper/error-mapper.js';

/**
 * Neutral taxpayer-registry lookup. The provider routes on the identification type, signs with this
 * service's own delegated credentials, and reports which registry answered via the result's `detail`. No
 * taxpayer registered under the identifier is a `404`, never an empty list.
 */
@JsonController('/taxpayers')
export class TaxpayersController {
    @Post('/lookup')
    async lookup(@Body() body: TaxpayerLookupRequestDto, @Res() res: Response): Promise<Response> {
        try {
            const result: TaxpayerResultDto = await getProvider(body.entityCode).lookupTaxpayers(
                body.environment,
                body.identificationTypeCode,
                body.identificationNumber,
            );
            return res.json(result);
        } catch (err) {
            return sendError(res, err);
        }
    }
}

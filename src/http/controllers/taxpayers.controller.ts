import type {Response} from 'express';
import {JsonController, Post, Res} from 'routing-controllers';
import {NotImplementedError} from '../../arca/index.js';
import {sendError} from '../error-mapper.js';

/**
 * Neutral taxpayer-registry (padrón) lookup. STUBBED for the skeleton — returns `501 Not Implemented`.
 *
 * Target (next pass): collapse ARCA padrón levels A4/A5/A10/A13 into one neutral taxpayer shape,
 * resolving the padrón-service ticket via the ticket store the same way the invoice endpoints do.
 */
@JsonController('/taxpayers')
export class TaxpayersController {
    @Post('/lookup')
    lookup(@Res() res: Response): Response {
        return sendError(res, new NotImplementedError('POST /taxpayers/lookup'));
    }
}

import type {Response} from 'express';
import {Body, Get, JsonController, Post, Res} from 'routing-controllers';
import {NotImplementedError} from '../../arca/index.js';
import {AuthorizeInvoiceRequestDto} from '../dto/neutral-invoice.dto.js';
import {sendError} from '../error-mapper.js';

/**
 * Neutral invoicing endpoints. STUBBED for the skeleton — each returns `501 Not Implemented`.
 *
 * Target flow (next pass): resolve an `ArcaAuth` via the ticket store (`409 TICKET_REQUIRED` on a cache
 * miss so core mints + re-sends), map the neutral document to the SDK request, call WSFEv1, and return
 * the neutral result.
 */
@JsonController('/invoices')
export class InvoicesController {
    @Post('/authorize')
    authorize(@Body() _body: AuthorizeInvoiceRequestDto, @Res() res: Response): Response {
        return sendError(res, new NotImplementedError('POST /invoices/authorize'));
    }

    @Get('/last-authorized')
    lastAuthorized(@Res() res: Response): Response {
        return sendError(res, new NotImplementedError('GET /invoices/last-authorized'));
    }

    @Post('/query')
    query(@Res() res: Response): Response {
        return sendError(res, new NotImplementedError('POST /invoices/query'));
    }
}

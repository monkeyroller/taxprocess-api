import type {Response} from 'express';
import {Body, JsonController, Post, Res} from 'routing-controllers';
import {getProvider} from '../../providers/registry/registry.js';
import {
    AuthorizeInvoiceRequestDto,
    LastAuthorizedRequestDto,
    LastRequestIdRequestDto,
    NextNumbersRequestDto,
    QueryVoucherRequestDto,
} from '../dto/invoice-request.dto.js';
import type {
    LastAuthorizedResultDto,
    LastRequestIdResultDto,
} from '../dto/authorization-result.dto.js';
import {sendError} from '../error-mapper/error-mapper.js';

/**
 * Invoicing endpoints. Each dispatches on `entityCode` to a provider, which resolves a ticket — a cache miss
 * with no credentials is a `409`, prompting core to re-send with the issuer's credentials.
 */
@JsonController('/invoices')
export class InvoicesController {
    @Post('/authorize')
    async authorize(@Body() body: AuthorizeInvoiceRequestDto, @Res() res: Response): Promise<Response> {
        try {
            const {entity, invoice} = body;
            const result = await getProvider(entity.entityCode).authorizeInvoice(entity, invoice);
            // 200 when authorized; 422 for a rejection or a partial.
            const approved =
                result.status === 'AUTHORIZED' && result.authorizationCode !== '' && result.expiration !== '';
            return res.status(approved ? 200 : 422).json(result);
        } catch (err) {
            return sendError(res, err);
        }
    }

    @Post('/last-authorized')
    async lastAuthorized(@Body() body: LastAuthorizedRequestDto, @Res() res: Response): Promise<Response> {
        try {
            const {entity} = body;
            const result: LastAuthorizedResultDto = await getProvider(entity.entityCode).lastAuthorized(
                entity,
                body.pointOfSaleNumber,
                body.documentTypeCode,
            );
            return res.json(result);
        } catch (err) {
            return sendError(res, err);
        }
    }

    @Post('/next-numbers')
    async nextNumbers(@Body() body: NextNumbersRequestDto, @Res() res: Response): Promise<Response> {
        try {
            const {entity} = body;
            const result = await getProvider(entity.entityCode).nextNumbers(
                entity,
                body.pointOfSaleNumber,
                body.documentTypeCodes,
            );
            return res.json(result);
        } catch (err) {
            return sendError(res, err);
        }
    }

    /**
     * The highest idempotency key the authority has seen for this issuer (AR: WSFEX `FEXGetLast_ID`).
     *
     * Core owns that sequence, this service having no database to keep it in, so this is how core seeds it
     * or recovers it after losing track — the only way back from a timeout, since re-using a key returns the
     * older voucher rather than an error. Answers `501` on an entity whose authority keeps no such key.
     */
    @Post('/last-request-id')
    async lastRequestId(@Body() body: LastRequestIdRequestDto, @Res() res: Response): Promise<Response> {
        try {
            const {entity} = body;
            const result: LastRequestIdResultDto = await getProvider(entity.entityCode).lastRequestId(entity);
            return res.json(result);
        } catch (err) {
            return sendError(res, err);
        }
    }

    @Post('/query')
    async query(@Body() body: QueryVoucherRequestDto, @Res() res: Response): Promise<Response> {
        try {
            const {entity} = body;
            const result = await getProvider(entity.entityCode).queryVoucher(
                entity,
                body.pointOfSaleNumber,
                body.documentTypeCode,
                body.voucherNumber,
            );
            return res.json(result);
        } catch (err) {
            return sendError(res, err);
        }
    }
}

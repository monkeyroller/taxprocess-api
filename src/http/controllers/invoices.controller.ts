import type {Response} from 'express';
import {Body, JsonController, Post, Res} from 'routing-controllers';
import {ServiceId} from '../../arca/index.js';
import {commonInvoiceService} from '../../arca-clients.js';
import {ticketStore} from '../../session/ticket-store.js';
import {
    AuthorizeInvoiceRequestDto,
    LastAuthorizedRequestDto,
    QueryVoucherRequestDto,
} from '../dto/invoice.dto.js';
import type {LastAuthorizedResultDto} from '../dto/neutral-result.dto.js';
import {buildCommonInvoiceRequest, buildQrUrl, toNeutralResult} from '../mappers/ar-invoice.mapper.js';
import {sendError} from '../error-mapper.js';

/**
 * Invoicing endpoints. Each resolves a WSFEv1 (`wsfe`) ticket via the ticket store — a cache miss
 * throws `TicketRequiredError` → `409 TICKET_REQUIRED`, prompting core to mint and re-send with the
 * ticket attached.
 */
@JsonController('/invoices')
export class InvoicesController {
    @Post('/authorize')
    async authorize(@Body() body: AuthorizeInvoiceRequestDto, @Res() res: Response): Promise<Response> {
        try {
            const {issuer, invoice} = body;
            const auth = ticketStore.resolve(issuer.cuit, ServiceId.WSFEV1, issuer.environment, issuer.ticket);
            const service = commonInvoiceService(issuer.environment);

            // ARCA is the source of truth for the voucher number: last-authorized + 1 keeps it correlative.
            const lastAuthorized = await service.getLastAuthorizedNumber(
                auth,
                invoice.salesPointNumber,
                invoice.voucherType,
            );
            const voucherNumber = lastAuthorized + 1;

            const request = buildCommonInvoiceRequest(invoice, voucherNumber, new Date());
            const result = await service.requestAuthorization(auth, request);

            if (result.result !== 'A' || result.cae === undefined || result.caeExpiration === undefined) {
                return res.status(422).json(toNeutralResult(result));
            }

            const qr = buildQrUrl(issuer.cuit, request, result.cae);
            return res.json(toNeutralResult(result, qr));
        } catch (err) {
            return sendError(res, err);
        }
    }

    @Post('/last-authorized')
    async lastAuthorized(@Body() body: LastAuthorizedRequestDto, @Res() res: Response): Promise<Response> {
        try {
            const {issuer} = body;
            const auth = ticketStore.resolve(issuer.cuit, ServiceId.WSFEV1, issuer.environment, issuer.ticket);
            const number = await commonInvoiceService(issuer.environment).getLastAuthorizedNumber(
                auth,
                body.salesPointNumber,
                body.voucherType,
            );
            const result: LastAuthorizedResultDto = {number};
            return res.json(result);
        } catch (err) {
            return sendError(res, err);
        }
    }

    @Post('/query')
    async query(@Body() body: QueryVoucherRequestDto, @Res() res: Response): Promise<Response> {
        try {
            const {issuer} = body;
            const auth = ticketStore.resolve(issuer.cuit, ServiceId.WSFEV1, issuer.environment, issuer.ticket);
            const result = await commonInvoiceService(issuer.environment).queryVoucher(
                auth,
                body.salesPointNumber,
                body.voucherType,
                body.voucherNumber,
            );
            return res.json(toNeutralResult(result));
        } catch (err) {
            return sendError(res, err);
        }
    }
}

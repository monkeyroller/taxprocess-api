import type {Response} from 'express';
import {Body, JsonController, Post, Res} from 'routing-controllers';
import {padronService, padronServiceId} from '../../arca-clients.js';
import {ticketStore} from '../../session/ticket-store.js';
import type {TaxpayerResultDto} from '../dto/neutral-result.dto.js';
import {TaxpayerLookupRequestDto} from '../dto/taxpayer.dto.js';
import {sendError} from '../error-mapper.js';

/**
 * Neutral taxpayer-registry (padrón) lookup. The plumbing is complete — it resolves the padrón-level
 * ticket via the ticket store (`409 TICKET_REQUIRED` on a miss) and calls the SDK.
 *
 * NOTE: the SDK's padrón `parseTaxpayer` is still a SEED for every level, so `getTaxpayer` currently
 * throws `NotImplementedError` (→ `501`) after the SOAP call. This endpoint returns real data once the
 * SDK level is implemented; no change is needed here.
 */
@JsonController('/taxpayers')
export class TaxpayersController {
    @Post('/lookup')
    async lookup(@Body() body: TaxpayerLookupRequestDto, @Res() res: Response): Promise<Response> {
        try {
            const {issuer} = body;
            const level = body.level ?? 'A5';
            const serviceId = padronServiceId(level);
            const auth = ticketStore.resolve(issuer.cuit, serviceId, issuer.environment, issuer.ticket);
            const data = await padronService(issuer.environment, level).getTaxpayer(auth, body.taxpayerId);
            const result: TaxpayerResultDto = {idPersona: data.idPersona, taxId: data.taxId, name: data.name};
            return res.json(result);
        } catch (err) {
            return sendError(res, err);
        }
    }
}

import type {Response} from 'express';
import {Body, JsonController, Post, Res} from 'routing-controllers';
import {getProvider} from '../../providers/registry/registry.js';
import type {TaxpayerResultDto} from '../dto/taxpayer-result.dto.js';
import type {CreditInvoiceObligationResultDto} from '../dto/credit-invoice-obligation-result.dto.js';
import {TaxpayerLookupRequestDto} from '../dto/taxpayer.dto.js';
import {CreditInvoiceObligationRequestDto} from '../dto/credit-invoice.dto.js';
import {sendError} from '../error-mapper/error-mapper.js';

/**
 * Questions about a taxpayer. Both read under this service's own delegated identity — neither carries an
 * issuer block, neither can answer `409 CREDENTIALS_REQUIRED` — and they differ on what an absence means:
 *
 * | | `/lookup` | `/credit-invoice-obligation` |
 * | --- | --- | --- |
 * | unknown taxpayer | **`404`**, never an empty list | **`obligated: false`**, never a `404` |
 * | authority down | `502` | a `200` answered from the offline register, labelled `LOCAL_REGISTRY` |
 *
 * The not-found rule inverts between them deliberately. For a registry lookup, "nobody is registered under
 * this identifier" is the answer and a caller must not confuse it with an empty result. For the obligation
 * question it is not an answer at all — an unregistered buyer is simply not obligated, and making the
 * caller translate an absence into a verdict is where that goes wrong.
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

    @Post('/credit-invoice-obligation')
    async creditInvoiceObligation(
        @Body() body: CreditInvoiceObligationRequestDto,
        @Res() res: Response,
    ): Promise<Response> {
        try {
            const result: CreditInvoiceObligationResultDto = await getProvider(
                body.entityCode,
            ).creditInvoiceObligation(
                body.environment,
                body.issuerTaxId,
                body.receiverTaxId,
                body.issueDate,
            );
            return res.json(result);
        } catch (err) {
            return sendError(res, err);
        }
    }
}

import type {Response} from 'express';
import {Body, JsonController, Post, Res} from 'routing-controllers';
import {getProvider} from '../../providers/registry/registry.js';
import type {CurrencyRatesResultDto} from '../dto/currency-rates-result.dto.js';
import {CurrencyRatesRequestDto} from '../dto/currency.dto.js';
import {sendError} from '../error-mapper/error-mapper.js';

/**
 * Neutral exchange-rate lookup. The provider signs with this service's own delegated credentials, resolves
 * the band the authority accepts around each published rate, and reports codes it had nothing for under
 * `unavailable` rather than failing the batch.
 *
 * Credential-free, so this endpoint never returns a `409` and no taxpayer has to delegate anything to us.
 */
@JsonController('/currencies')
export class CurrenciesController {
    @Post('/rates')
    async rates(@Body() body: CurrencyRatesRequestDto, @Res() res: Response): Promise<Response> {
        try {
            const result: CurrencyRatesResultDto = await getProvider(body.entityCode).currencyRates(
                body.environment,
                body.currencyCodes,
                body.date,
            );
            return res.json(result);
        } catch (err) {
            return sendError(res, err);
        }
    }
}

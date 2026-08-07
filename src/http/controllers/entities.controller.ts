import type {Response} from 'express';
import {Body, JsonController, Param, Post, Res} from 'routing-controllers';
import {getProvider} from '../../providers/registry.js';
import {ValidateCredentialsRequestDto} from '../dto/credentials.dto.js';
import {sendError} from '../error-mapper.js';

/**
 * Entity credential validation (H3). Core calls this synchronously during `POST /integrations` so bad
 * credentials are rejected at registration time. Dispatches on the `:entityCode` path param; the
 * provider validates the `configuration` + `credentials` shape and correctness.
 */
@JsonController('/entities')
export class EntitiesController {
    @Post('/:entityCode/credentials/validate')
    async validateCredentials(
        @Param('entityCode') entityCode: string,
        @Body() body: ValidateCredentialsRequestDto,
        @Res() res: Response,
    ): Promise<Response> {
        try {
            const result = await getProvider(entityCode).validateCredentials({
                environment: body.environment,
                configuration: body.configuration,
                credentials: body.credentials,
            });
            return res.json(result);
        } catch (err) {
            return sendError(res, err);
        }
    }
}

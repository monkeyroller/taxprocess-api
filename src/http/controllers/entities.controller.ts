import type {Response} from 'express';
import {Body, JsonController, Param, Post, Res} from 'routing-controllers';
import {getProvider} from '../../providers/registry/registry.js';
import {ValidateCredentialsRequestDto} from '../dto/credentials.dto.js';
import {sendError} from '../error-mapper/error-mapper.js';

/**
 * Entity credential validation. Core calls this synchronously while registering an integration, so bad
 * credentials are rejected up front. The provider validates the shape and correctness of both blocks.
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
                expectedTaxId: body.expectedTaxId,
            });
            return res.json(result);
        } catch (err) {
            return sendError(res, err);
        }
    }
}

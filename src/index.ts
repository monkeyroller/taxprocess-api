import 'reflect-metadata';
import {createServer} from 'node:http';
import express, {type NextFunction, type Request, type Response} from 'express';
import cors from 'cors';
import {useExpressServer} from 'routing-controllers';
import {env} from './config/env.js';
import {delegateCredentialStore} from './providers/arca/auth/delegate-credentials/delegate-credentials.js';
import {StatusController} from './http/controllers/status.controller.js';
import {InvoicesController} from './http/controllers/invoices.controller.js';
import {PointsOfSaleController} from './http/controllers/points-of-sale.controller.js';
import {TaxpayersController} from './http/controllers/taxpayers.controller.js';
import {EntitiesController} from './http/controllers/entities.controller.js';
import {CurrenciesController} from './http/controllers/currencies.controller.js';
import {toHttpError} from './http/error-mapper/error-mapper.js';

/**
 * Safety net for errors that reach the framework layer, chiefly the class-validator `400`s raised before an
 * action runs. Controllers map their own errors in-action; this catches the rest.
 */
function errorHandler(err: unknown, _req: Request, res: Response, next: NextFunction): void {
    if (res.headersSent) {
        next(err);
        return;
    }
    const {status, body} = toHttpError(err);
    res.status(status).json(body);
}

function bootstrap(): void {
    // Fails fast if a delegate certificate is configured but unusable, rather than on the first delegated
    // request. A no-op when none is configured.
    delegateCredentialStore.validateConfigured();

    const app = express();
    app.use(cors({origin: env.corsOrigin, credentials: true}));

    useExpressServer(app, {
        routePrefix: '/api',
        controllers: [
            StatusController,
            InvoicesController,
            PointsOfSaleController,
            TaxpayersController,
            EntitiesController,
            CurrenciesController
        ],
        validation: {
            whitelist: true,
            forbidNonWhitelisted: true
        },
        defaultErrorHandler: false,
        cors: false,
    });

    // Registered after the controllers so routing-controllers forwards unhandled errors here.
    app.use(errorHandler);

    const server = createServer(app);
    server.listen(env.port, () => {
        console.log(`taxprocess-api listening on :${env.port} (${env.nodeEnv})`);
    });

    const shutdown = (signal: string): void => {
        console.log(`Received ${signal}, shutting down.`);
        server.close(() => {
            process.exit(0);
        });
    };
    process.on('SIGTERM', () => {
        shutdown('SIGTERM');
    });
    process.on('SIGINT', () => {
        shutdown('SIGINT');
    });
}

bootstrap();

import express, {type NextFunction, type Request, type Response} from 'express';
import cors from 'cors';
import {useExpressServer} from 'routing-controllers';
import {env} from '../config/env.js';
import {StatusController} from './controllers/status.controller.js';
import {InvoicesController} from './controllers/invoices.controller.js';
import {PointsOfSaleController} from './controllers/points-of-sale.controller.js';
import {TaxpayersController} from './controllers/taxpayers.controller.js';
import {EntitiesController} from './controllers/entities.controller.js';
import {CurrenciesController} from './controllers/currencies.controller.js';
import {sendError} from './error-mapper/error-mapper.js';

/** Every controller mounted by the service, in the order `useExpressServer` registers them. */
export const CONTROLLERS = [
    StatusController,
    InvoicesController,
    PointsOfSaleController,
    TaxpayersController,
    EntitiesController,
    CurrenciesController,
] as const;

/**
 * Safety net for errors that reach the framework layer, chiefly the class-validator `400`s raised before an
 * action runs. Controllers map their own errors in-action; this catches the rest.
 */
function errorHandler(err: unknown, _req: Request, res: Response, next: NextFunction): void {
    if (res.headersSent) {
        next(err);
        return;
    }
    sendError(res, err);
}

/**
 * Assembles the HTTP app: CORS, the controllers under `/api`, and the framework-level error handler.
 *
 * Split out of `bootstrap` so the contract tests can drive the *same* wiring over a real socket rather than
 * a copy of it. `whitelist`/`forbidNonWhitelisted` are load-bearing contract behaviour (CONTRACT §1) and a
 * test that restated these options here would pass while this file drifted.
 *
 * Deliberately does not touch the delegate credential store or bind a port — that is `bootstrap`'s job, and
 * keeping it out is what lets a test build the app without a certificate.
 */
export function createApp(): express.Express {
    const app = express();
    app.use(cors({origin: env.corsOrigin, credentials: true}));

    useExpressServer(app, {
        routePrefix: '/api',
        controllers: [...CONTROLLERS],
        validation: {
            whitelist: true,
            forbidNonWhitelisted: true
        },
        defaultErrorHandler: false,
        cors: false,
    });

    // Registered after the controllers so routing-controllers forwards unhandled errors here.
    app.use(errorHandler);
    return app;
}

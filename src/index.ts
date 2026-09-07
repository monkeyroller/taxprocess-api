import 'reflect-metadata';
import {createServer} from 'node:http';
import {env} from './config/env.js';
import {delegateCredentialStore} from './providers/arca/auth/delegate-credentials/delegate-credentials.js';
import {createApp} from './http/app.js';

function bootstrap(): void {
    // Fails fast if a delegate certificate is configured but unusable, rather than on the first delegated
    // request. A no-op when none is configured.
    delegateCredentialStore.validateConfigured();

    const server = createServer(createApp());
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

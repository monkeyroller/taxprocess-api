import 'reflect-metadata';
import {getMetadataArgsStorage} from 'routing-controllers';
import {CONTROLLERS} from './app.js';

/**
 * Guards the one runtime assumption every `@Body()` DTO rests on: that the compiler emitted
 * `design:paramtypes` for controller actions.
 *
 * routing-controllers reads that metadata to learn a body's target class. Without it `ParamMetadata.targetType`
 * is `undefined`, `isTargetObject` stays `false`, and `ActionParameterHandler.normalizeParamValue` skips both
 * `plainToInstance` and `validateOrReject` — so every DTO decorator in `src/http/dto` becomes dead weight and
 * the action receives the raw parsed JSON. Nothing logs, no route 404s, and the service answers `200`.
 *
 * That is not hypothetical. Running this service under `tsx`/esbuild does exactly that: esbuild implements
 * `experimentalDecorators` but NOT `emitDecoratorMetadata`, so a server started with `npx tsx src/index.ts`
 * accepts undeclared fields, ignores `@IsDefined()` on `entity` (a missing block becomes a `500` where the
 * contract promises a `400`), and reads `currencyCodes: "DOL"` as three one-character codes. `pnpm dev`
 * (nodemon → `ts-node/esm`), `pnpm test` (ts-jest) and `pnpm build` (tsc) all emit it correctly.
 *
 * Crashing at boot is the point: a silently unvalidated tax-authority gateway is far worse than one that
 * refuses to start.
 *
 * Every `@Body()` on every mounted controller is checked, read back out of the same metadata storage
 * `useExpressServer` routes from, rather than one hard-coded action: naming an action here would make a
 * rename report a missing-metadata emergency, and would leave a controller added without the emit silently
 * unguarded.
 */
const REMEDY =
    "This runtime does not support TypeScript's emitDecoratorMetadata — esbuild-based loaders such as " +
    '`tsx` are the usual cause. Start the service with `pnpm dev` (ts-node) or `pnpm build && pnpm serve` (tsc).';

/**
 * Whether a decorated method belongs to a mounted controller — `proto` itself, or a base class it inherits
 * from. routing-controllers stores a param against the prototype that *declares* it, so an action shared by
 * a base class would otherwise be skipped by the very guard that exists to prevent silent skips.
 */
function isMounted(proto: object): boolean {
    return CONTROLLERS.some(
        (controller) =>
            proto === controller.prototype || Object.prototype.isPrototypeOf.call(proto, controller.prototype),
    );
}

export function assertDecoratorMetadataEmitted(): void {
    // Reading `CONTROLLERS` is also what guarantees the decorators have run: the storage is populated as a
    // side effect of loading the controller modules, so an empty sweep would otherwise look like a pass.
    const bodies = getMetadataArgsStorage().params.filter(
        (param) => param.type === 'body' && isMounted(param.object as object),
    );

    if (bodies.length === 0) {
        throw new Error(
            'Decorator metadata is missing: no `@Body()` parameter is registered for any mounted ' +
                'controller, so the decorators never ran. Request-body validation would be silently ' +
                'disabled. ' + REMEDY,
        );
    }

    for (const {object, method, index} of bodies) {
        // `ParamMetadataArgs.object` is typed `any` by routing-controllers; it is the controller prototype.
        const target = object as object;
        const paramTypes: unknown = Reflect.getMetadata('design:paramtypes', target, method);
        const bodyType: unknown = Array.isArray(paramTypes) ? paramTypes[index] : undefined;
        // `Object` is rejected as hard as a missing entry, and it is the likelier of the two: `typeof Object`
        // is `'function'`, so it passes every check that only asks whether *something* was emitted. TypeScript
        // emits it whenever the DTO reached the signature as a type rather than a value — a `import type
        // {FooDto}`, the prevailing spelling in this directory. routing-controllers then hands
        // `plainToInstance` a bare `Object`, which carries no validators, and `whitelist` /
        // `forbidNonWhitelisted` quietly stop applying to that route. Same outcome the message names, so it
        // gets the same failure; `esbuild`/`tsx` are unaffected, emitting no metadata at all.
        if (typeof bodyType !== 'function' || bodyType === Object) {
            const name = target.constructor.name;
            const cause = bodyType === Object ? 'was emitted as `Object`' : 'was not emitted';
            throw new Error(
                `Decorator metadata is missing: \`design:paramtypes\` ${cause} for ${name}.${method}. ` +
                    'Request-body validation would be silently disabled (unknown fields accepted, required ' +
                    'blocks unchecked). ' +
                    (bodyType === Object
                        ? 'A body DTO reached the signature as a type rather than a value — import it with ' +
                          '`import {FooDto}`, not `import type {FooDto}`. '
                        : REMEDY),
            );
        }
    }
}


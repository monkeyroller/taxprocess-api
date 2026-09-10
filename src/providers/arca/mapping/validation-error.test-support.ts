/**
 * Reading an `ArcaValidationError` in a test — the `details.code` a refusal carries, and the message a caller
 * reads.
 *
 * One pair rather than a copy per suite, because the copies had drifted into different failure behaviour: one
 * threw when the call raised nothing, the other returned `null` for both "did not throw" and "threw something
 * else", which makes a `TypeError` indistinguishable from a clean return. An assertion moved between the two
 * suites silently changed meaning.
 *
 * Both take the strict reading: a call that raises nothing, or raises anything other than an
 * `ArcaValidationError`, fails the test where it happens rather than being reported as an absent code.
 *
 * Not a `*.test.ts` file — Jest's `testMatch` would collect it as a suite with no tests — and excluded from
 * `tsconfig.build.json`, so test support does not reach `dist`.
 */
import {ArcaValidationError} from '../sdk/core/errors.js';

/** The error a call is required to throw, or a test failure naming what it did instead. */
function validationErrorFrom(call: () => unknown): ArcaValidationError {
    try {
        call();
    } catch (error) {
        if (error instanceof ArcaValidationError) {
            return error;
        }
        throw new Error(
            `expected an ArcaValidationError, got ${error instanceof Error ? error.name : typeof error}: ` +
                String(error),
        );
    }
    throw new Error('expected a validation error, but the call returned');
}

/** The `details.code` of the `ArcaValidationError` `call` throws. */
export function codeOf(call: () => unknown): string | undefined {
    return validationErrorFrom(call).code;
}

/** The message of the `ArcaValidationError` `call` throws — for assertions about what a caller reads. */
export function messageOf(call: () => unknown): string {
    return validationErrorFrom(call).message;
}

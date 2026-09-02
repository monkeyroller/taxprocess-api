import fs from 'node:fs';
import {
    canonicalizeCertificatePem,
    canonicalizePrivateKeyPem,
    certificateSubjectSerialNumber,
    isCertificateSigningRequest,
    keyMatchesCertificatePem,
} from '../../../pem/pem.js';
import {canonicalCuit} from '../../mapping/identifiers.js';
import {env, type ArcaDelegateConfig} from '../../../../config/env.js';
import {DelegationNotConfiguredError} from '../../../provider/faults.js';
import type {GenericEnvironment} from '../../../provider/environment.js';

/**
 * The service's own ARCA delegate certificate for one environment — the platform credential this service
 * signs WSAA logins with when acting on behalf of a represented taxpayer. `delegateCuit` is the canonical
 * CUIT read from the certificate subject.
 *
 * The PEMs are canonical rather than the raw configured strings: the validators tolerate armor and newline
 * defects but the WSAA signer does not, so storing the raw value would pass boot validation and then fail to
 * sign on every delegated request.
 */
export interface DelegateCredentials {
    readonly certPem: string;
    readonly keyPem: string;
    readonly delegateCuit: string;
}

/** Reads a PEM from an inline value or a file path; `undefined` when neither is configured. */
function readPemSource(
    environment: GenericEnvironment,
    inline: string | undefined,
    path: string | undefined,
    what: string,
): string | undefined {
    if (inline !== undefined) {
        return inline;
    }
    if (path === undefined) {
        return undefined;
    }
    try {
        return fs.readFileSync(path, 'utf8');
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new DelegationNotConfiguredError(environment, `${what} file at "${path}" could not be read: ${detail}`);
    }
}

/**
 * Loads, validates and caches the delegate certificate per environment — a single platform credential, so it
 * is read once and memoized. `get()` returns the validated bundle, `undefined` when the environment has no
 * delegate cert at all, and throws when one is configured but unusable. Boot calls `validateConfigured` so a
 * misconfiguration fails fast at startup rather than on the first delegated request.
 */
export class DelegateCredentialStore {
    private readonly cache = new Map<GenericEnvironment, DelegateCredentials | null>();

    constructor(private readonly config: ArcaDelegateConfig = env.arcaDelegate) {}

    /** Validated delegate credentials for `environment`, or `undefined` when none are configured. */
    get(environment: GenericEnvironment): DelegateCredentials | undefined {
        const cached = this.cache.get(environment);
        if (cached !== undefined) {
            return cached ?? undefined;
        }
        const loaded = this.load(environment);
        this.cache.set(environment, loaded ?? null);
        return loaded;
    }

    /** Eagerly loads both environments so a bad delegate cert fails fast at boot. Safe when none set. */
    validateConfigured(): void {
        this.get('production');
        this.get('testing');
    }

    /**
     * True when `certPem` is the certificate this environment's delegate identity signs with, compared as
     * canonical PEM so formatting differences never make the same certificate look different. Decides
     * whether a tenant request may share the delegate's cached WSAA ticket; a broken or absent delegate
     * config is simply "no match", never a failure of that request.
     */
    matchesDelegateCertificate(environment: GenericEnvironment, certPem: string): boolean {
        let delegate: DelegateCredentials | undefined;
        try {
            delegate = this.get(environment);
        } catch {
            return false; // a misconfigured delegate cert must not break a tenant request
        }
        if (delegate === undefined) {
            return false;
        }
        const canonical = canonicalizeCertificatePem(certPem);
        return canonical !== null && canonical === delegate.certPem;
    }

    private load(environment: GenericEnvironment): DelegateCredentials | undefined {
        const source = this.config[environment];
        const rawCert = readPemSource(environment, source.certPem, source.certPath, 'certificate');
        const rawKey = readPemSource(environment, source.keyPem, source.keyPath, 'private key');

        if (rawCert === undefined && rawKey === undefined) {
            return undefined; // delegation simply not configured for this environment
        }
        if (rawCert === undefined) {
            throw new DelegationNotConfiguredError(environment, 'a private key is set but no certificate');
        }
        if (rawKey === undefined) {
            throw new DelegationNotConfiguredError(environment, 'a certificate is set but no private key');
        }

        if (isCertificateSigningRequest(rawCert)) {
            throw new DelegationNotConfiguredError(environment, 'the certificate is a CSR, not an issued certificate');
        }
        // The canonical form is kept: validating a repaired PEM but signing with the raw one would let an
        // unarmored or escaped-newline value pass boot and then fail in the WSAA signer.
        const certPem = canonicalizeCertificatePem(rawCert);
        if (certPem === null) {
            throw new DelegationNotConfiguredError(environment, 'the certificate is not a valid X.509 certificate');
        }
        const keyPem = canonicalizePrivateKeyPem(rawKey);
        if (keyPem === null) {
            throw new DelegationNotConfiguredError(environment, 'the private key is not a valid RSA key');
        }
        if (!keyMatchesCertificatePem(certPem, keyPem)) {
            throw new DelegationNotConfiguredError(environment, 'the private key does not match the certificate');
        }

        const serial = certificateSubjectSerialNumber(certPem);
        const delegateCuit = serial === null ? null : canonicalCuit(serial);
        if (delegateCuit === null) {
            throw new DelegationNotConfiguredError(environment, 'the certificate subject carries no CUIT');
        }

        // Guards against deploying a cert for the wrong organization.
        if (this.config.expectedTaxId !== undefined) {
            const expected = canonicalCuit(this.config.expectedTaxId);
            if (expected === null) {
                throw new DelegationNotConfiguredError(
                    environment,
                    `ARCA_DELEGATE_TAXID "${this.config.expectedTaxId}" is not a valid CUIT`,
                );
            }
            if (expected !== delegateCuit) {
                throw new DelegationNotConfiguredError(
                    environment,
                    `the certificate CUIT ${delegateCuit} does not match ARCA_DELEGATE_TAXID ${expected}`,
                );
            }
        }

        return {certPem, keyPem, delegateCuit};
    }
}

/** Process-wide delegate certificate store. */
export const delegateCredentialStore = new DelegateCredentialStore();

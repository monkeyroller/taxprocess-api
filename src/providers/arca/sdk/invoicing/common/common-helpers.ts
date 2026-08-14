// ---- WSFEv1 wire helpers ----

import {ArcaAuth} from "../../core/types.js";
import {ArcaObservation} from "./common-invoice.types.js";

export function authElement(auth: ArcaAuth): Record<string, unknown> {
    return {Token: auth.token, Sign: auth.sign, Cuit: auth.cuit};
}

export function money(value: number): string {
    return value.toFixed(2);
}

/** Normalizes fast-xml-parser's single-vs-array output to the first element (or undefined). */
export function firstOf(node: unknown): Record<string, any> | undefined {
    if (node === undefined || node === null) {
        return undefined;
    }
    return (Array.isArray(node) ? node[0] : node) as Record<string, any>;
}

export function toInt(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

/** Treats ARCA's empty markers (`""`, `"0"`) as absent. */
export function cleanCode(value: unknown): string | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }
    const s = String(value).trim();
    return s === '' || s === '0' ? undefined : s;
}

/** Like {@link cleanCode} for date fields that ARCA fills with the literal `"NULL"` when empty (e.g. `FchBaja`). */
export function cleanArcaDate(value: unknown): string | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }
    const s = String(value).trim();
    return s === '' || s === '0' || s.toUpperCase() === 'NULL' ? undefined : s;
}

export function normalizeResultCode(value: string | undefined): 'A' | 'R' | 'P' {
    return value === 'A' || value === 'P' ? value : 'R';
}

export function extractObservations(node: unknown): Array<ArcaObservation> {
    const obs = (node as { Obs?: unknown } | undefined)?.Obs;
    if (!obs) {
        return [];
    }
    const list = Array.isArray(obs) ? obs : [obs];
    return list.map((o: { Code?: unknown; Msg?: unknown }) => ({
        code: String(o.Code),
        message: String(o.Msg),
    }));
}

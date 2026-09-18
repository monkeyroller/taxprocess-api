/**
 * What ARCA's homologación WSFECRED answers for, measured rather than published.
 *
 * The sibling `padron-homologacion-ids.ts` vendors ARCA's *published* cast. There is no equivalent to copy
 * here, and the document that looks like one is a trap: ARCA publishes
 * `documentos/Pruebas-homologacion-WS-FCE.xlsx`, 830 companies presented as the homologación test set, and
 * **the service does not answer from it**. Measured on 2026-09-18, two of its companies come back
 * `obligado: false` while companies absent from it come back `true` — the register tracks something
 * production-shaped instead. Reading the workbook and testing against it would produce a suite that fails
 * for reasons nothing in this repository could explain.
 *
 * So everything below was obtained by asking the service. Values are what it returned on **2026-09-18**,
 * end to end through `FeCredService`. Testing-register data rather than a promise: treat a drift as
 * something to re-record, not as a regression.
 *
 * Meaningless in `produccion`, and one difference matters more than the rest — see
 * {@link FECRED_HOMOLOGACION_THRESHOLDS}.
 */

/** One receiver the homologación register was asked about, and what it said. */
export interface FecredHomologacionReceiver {
    /** Digits only, the form `cuitConsultada` takes. */
    readonly taxId: string;
    readonly obligated: boolean;
    /** `montoDesde` as at `2026-09-18`. Absent exactly when `obligated` is false. */
    readonly thresholdAmount?: number;
    readonly note: string;
}

/**
 * The cast, covering every distinct answer the register gives.
 *
 * Small on purpose. The register holds over a thousand companies and they nearly all behave identically —
 * what is worth pinning is one of each *kind* of answer, which is three: obligated with a floor, not
 * obligated, and the workbook companies that prove the workbook is not the source.
 */
export const FECRED_HOMOLOGACION_RECEIVERS: ReadonlyArray<FecredHomologacionReceiver> = [
    // Legal entities listed since the régimen began. The ordinary obligated case.
    {taxId: '30500000127', obligated: true, thresholdAmount: 3958316, note: 'SEGUROS SURA — listed 2019-05-01'},
    {taxId: '30500001735', obligated: true, thresholdAmount: 3958316, note: 'BANCO DE GALICIA — listed 2019-05-01'},
    {taxId: '30500005625', obligated: true, thresholdAmount: 3958316, note: 'CITIBANK NA — listed 2019-05-01'},

    // An individual rather than a company, to show the register does not distinguish them.
    {taxId: '20054100605', obligated: true, thresholdAmount: 3958316, note: 'GRAELLS NELSON ANTONIO — listed 2019-10-01'},

    // Present in the production listing and absent from the workbook, yet answered `true`. Half of the
    // evidence that the register is not reading the workbook.
    {taxId: '20081585505', obligated: true, thresholdAmount: 3958316, note: 'production listing only; alta 2026-09-01'},
    {taxId: '20165325444', obligated: true, thresholdAmount: 3958316, note: 'production listing only; alta 2026-09-01'},

    // The other half: in the workbook, and the register says no. Do not "fix" these by trusting the
    // spreadsheet — measure again instead.
    {taxId: '23043831739', obligated: false, note: 'in the published workbook, NOT in the register'},
    {taxId: '30500001115', obligated: false, note: 'in the published workbook, NOT in the register'},

    // In neither, which is the shape of an ordinary buyer. Note it is an answer, never a not-found.
    {taxId: '20111111112', obligated: false, note: 'in no register — the common case'},
];

/** One `(issueDate → answer)` reading for a single receiver. */
export interface FecredHomologacionThreshold {
    /** `fechaEmision`, an `xsd:date`. */
    readonly issueDate: string;
    readonly obligated: boolean;
    readonly thresholdAmount?: number;
}

/**
 * The same receiver asked about across years — the reading that settles what `montoDesde` actually is.
 *
 * **The floor is a function of the issue date, not of the receiver's activity.** Eight different principal
 * activities asked about on one day all answered `3958316`, while this one receiver asked about across
 * seven years walks a ladder. So `issueDate` is not a formality: a backdated voucher is judged against the
 * régimen as it stood then, and asking with today's date would compare a 2021 sale against a floor twenty
 * times too high.
 *
 * The first row is the other half of that: `2019-01-01` answers `false` because this receiver's obligation
 * began on `2019-05-01`, and the register applies that start date exactly.
 *
 * ⚠️ **Homologación's series stops at `3958316`, and production's does not.** ARCA raised the general limit
 * with Resolución 1/2026, effective 2026-04-14, to a figure materially higher than this one — it is in
 * `obligated-receivers.generated.ts` and deliberately nowhere else, so it is not repeated here. The testing
 * register has not taken that rise up: asked about 2026-04-14 it still answers `3958316`.
 *
 * That gap is the clearest possible argument for the rule the contract already states — read `montoDesde`
 * off the service and pass it through, and where the service disagrees with a published figure, the service
 * wins. It is also why nothing here may be used to "correct" the vendored offline snapshot, which holds the
 * production figure and is right to.
 *
 * A date in the future is refused, in-payload, as `10000 "Error interno de la aplicación"` — a generic code
 * rather than a validation one, so it is not worth classifying.
 */
export const FECRED_HOMOLOGACION_THRESHOLDS: ReadonlyArray<FecredHomologacionThreshold> = [
    {issueDate: '2019-01-01', obligated: false},
    {issueDate: '2019-05-01', obligated: true, thresholdAmount: 146885},
    {issueDate: '2020-06-01', obligated: true, thresholdAmount: 146885},
    {issueDate: '2021-06-01', obligated: true, thresholdAmount: 195698},
    {issueDate: '2022-06-01', obligated: true, thresholdAmount: 299555},
    {issueDate: '2023-06-01', obligated: true, thresholdAmount: 546737},
    {issueDate: '2024-06-01', obligated: true, thresholdAmount: 1357480},
    {issueDate: '2025-06-01', obligated: true, thresholdAmount: 3958316},
    {issueDate: '2026-09-18', obligated: true, thresholdAmount: 3958316},
];

/** The receiver {@link FECRED_HOMOLOGACION_THRESHOLDS} was measured against. */
export const FECRED_HOMOLOGACION_THRESHOLD_RECEIVER = '30500000127';

/**
 * A receiver whose start date differs between the two environments.
 *
 * The production listing gives `20081585505` an alta of `2026-09-01`; homologación answers `true` for
 * `2026-08-15`. Recorded because it looks like a counter-example to the start-date rule and is not — the
 * rule holds exactly for {@link FECRED_HOMOLOGACION_THRESHOLD_RECEIVER}, whose listed `2019-05-01` is
 * honoured to the day. The two registers simply hold different alta data for this company, which is what a
 * testing register is entitled to do.
 *
 * Worth one production check before the offline snapshot's per-row start dates are trusted completely.
 */
export const FECRED_HOMOLOGACION_ALTA_MISMATCH = '20081585505';

/**
 * Result of `GET /health` — a liveness probe, consulting no provider. Declared here rather than in the
 * controller because it is a contract surface like every other response shape: a caller's health check reads
 * these three keys, so changing one is breaking.
 */
export class HealthResultDto {
    /** Always `ok` — a process that could not answer would not be reached at all. */
    status!: 'ok';

    /** This service's name, so a probe pointed at the wrong host can tell. */
    service!: string;

    /** Whole seconds since this process started. */
    uptimeSeconds!: number;
}

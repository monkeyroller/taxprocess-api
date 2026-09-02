/** The neutral point-of-sale list a provider reports for an entity/issuer. */

/** One point of sale (AR: Punto de Venta) as reported by the authority. */
export class PointOfSaleDto {
    /** The point-of-sale number (AR: Nro / PtoVta). */
    number!: number;

    /** Issuance mode the point is registered for (AR: EmisionTipo, e.g. 'CAE', 'CAEA', 'RECE'). */
    issuanceMode?: string;

    /** True when the authority has the point of sale blocked (AR: Bloqueado = 'S'). */
    blocked!: boolean;

    /** De-registration date (ISO-8601) when the point has been dropped (AR: FchBaja); undefined while active. */
    dischargeDate?: string;
}

/** Result of `POST /points-of-sale` — every point of sale the authority has on file for the entity. */
export class PointsOfSaleResultDto {
    pointsOfSale!: Array<PointOfSaleDto>;
}

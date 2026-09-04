import {Type} from 'class-transformer';
import {IsDefined, IsIn, IsOptional, ValidateNested} from 'class-validator';
import {EntityAuthDto} from './entity-auth.dto.js';
import {WEB_SERVICES, type WebService} from '../../providers/provider/web-service.js';

/** Body for `POST /points-of-sale` — identity plus which of the entity's registers to read. */
export class PointsOfSaleRequestDto {
    // `@IsDefined` alongside `@ValidateNested`: nested validation alone passes a missing `entity`, which the
    // controller then dereferences — a `500` where this makes it a `400`.
    @IsDefined()
    @ValidateNested()
    @Type(() => EntityAuthDto)
    entity!: EntityAuthDto;

    /**
     * Which of the entity's web services to ask (its `configuration.webService`). Omitted is the ordinary
     * invoicing register.
     *
     * It matters because an entity can keep more than one register and they need not overlap: AR keeps a
     * separate one for export vouchers, and a point of sale enrolled for ordinary invoicing cannot issue an
     * export voucher. Without this, a caller checking whether it can issue one would be shown the wrong
     * list and conclude that it can.
     */
    @IsOptional()
    @IsIn(WEB_SERVICES)
    webService?: WebService;
}

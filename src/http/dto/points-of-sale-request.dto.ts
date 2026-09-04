import {Type} from 'class-transformer';
import {IsDefined, ValidateNested} from 'class-validator';
import {EntityAuthDto} from './entity-auth.dto.js';

/** Body for `POST /points-of-sale` — identity only; the point-of-sale list is scoped to the entity/issuer. */
export class PointsOfSaleRequestDto {
    // `@IsDefined` alongside `@ValidateNested`: nested validation alone passes a missing `entity`, which the
    // controller then dereferences — a `500` where this makes it a `400`.
    @IsDefined()
    @ValidateNested()
    @Type(() => EntityAuthDto)
    entity!: EntityAuthDto;
}

import { IsIn, IsISO8601, IsOptional, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { SLOT_ORDER } from '../../time.utils';
import type { Slot } from '../../time.utils';

export class CreateVideoJobDto {
  @ApiPropertyOptional({
    example: 'd766cd09-66f7-4a22-a8d5-2cf05a2dc7d4',
    format: 'uuid',
    description: 'Offer to associate with the generated video job.',
  })
  @IsOptional()
  @IsUUID()
  offerId?: string;

  @ApiPropertyOptional({
    enum: SLOT_ORDER,
    example: 'MORNING',
    description: 'Publishing slot for the new video job. Defaults to MORNING.',
  })
  @IsOptional()
  @IsIn(SLOT_ORDER)
  slot?: Slot;

  @ApiPropertyOptional({
    example: '2026-05-30T14:00:00.000Z',
    format: 'date-time',
    description:
      'Optional ISO timestamp for the scheduled render/publish time.',
  })
  @IsOptional()
  @IsISO8601()
  scheduledFor?: string;
}

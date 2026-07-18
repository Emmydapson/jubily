import { IsBoolean, IsIn, IsISO8601, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SLOT_ORDER } from './time.utils';
import type { Slot } from './time.utils';

export class RunSlotDto {
  @ApiProperty({
    enum: SLOT_ORDER,
    example: 'MORNING',
    description: 'Scheduled publishing slot to run.',
  })
  @IsIn(SLOT_ORDER)
  slot!: Slot;

  @ApiPropertyOptional({
    example: '2026-05-30T14:00:00.000Z',
    format: 'date-time',
    description: 'Optional ISO timestamp to use as the scheduled run time.',
  })
  @IsOptional()
  @IsISO8601()
  scheduledFor?: string;

  @ApiPropertyOptional({
    example: false,
    description:
      'When true, failed terminal jobs for the same slot can be reset and rerun.',
  })
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

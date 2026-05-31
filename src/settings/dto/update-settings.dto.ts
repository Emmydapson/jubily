/* eslint-disable prettier/prettier */
import { ArrayNotEmpty, IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateSettingsDto {
  @ApiPropertyOptional({ example: true, description: 'Enable or disable automation globally.' })
  @IsOptional()
  @IsBoolean()
  automationEnabled?: boolean;

  @ApiPropertyOptional({ example: true, description: 'Enable or disable vertical content automation.' })
  @IsOptional()
  @IsBoolean()
  verticalEnabled?: boolean;

  @ApiPropertyOptional({ example: false, description: 'Automatically publish completed videos.' })
  @IsOptional()
  @IsBoolean()
  autoPublish?: boolean;

  @ApiPropertyOptional({ example: 'America/New_York', description: 'IANA timezone used for scheduling.' })
  @IsOptional()
  @IsString()
  timezone?: string; // e.g. "America/New_York"

  @ApiPropertyOptional({ example: 3, minimum: 1, maximum: 3, description: 'Number of videos to produce per day.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3)
  @Type(() => Number)
  videosPerDay?: number;

  @ApiPropertyOptional({
    example: [9, 13, 18],
    type: [Number],
    minimum: 0,
    maximum: 23,
    description: 'UTC or configured-timezone run hours in 24-hour format.',
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(23, { each: true })
  @Type(() => Number)
  runHours?: number[]; // e.g. [9, 13, 18]
}

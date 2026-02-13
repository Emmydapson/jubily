/* eslint-disable prettier/prettier */
import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional()
  @IsBoolean()
  automationEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  verticalEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  autoPublish?: boolean;

  @IsOptional()
  @IsString()
  timezone?: string; // e.g. "America/New_York"

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  videosPerDay?: number;

  @IsOptional()
  @IsArray()
  runHours?: number[]; // e.g. [9, 13, 18]
}

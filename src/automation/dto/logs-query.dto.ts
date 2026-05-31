import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class LogsQueryDto {
  @ApiPropertyOptional({
    example: 20,
    minimum: 1,
    maximum: 200,
    description: 'Maximum number of automation log rows to return.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

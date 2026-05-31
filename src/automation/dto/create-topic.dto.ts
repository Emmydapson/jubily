/* eslint-disable prettier/prettier */
import { IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTopicDto {
  @ApiProperty({
    example: 'Morning habits for more energy',
    description: 'Topic title to use as source material for automation scripts.',
  })
  @IsString()
  title: string;

  @ApiPropertyOptional({
    example: 'google-sheets',
    description: 'Where the topic came from.',
  })
  @IsOptional()
  @IsString()
  source?: string;

  @ApiPropertyOptional({
    example: 80,
    minimum: 0,
    maximum: 100,
    description: 'Optional prioritization score.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  score?: number;
}

import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateScriptDto {
  @ApiPropertyOptional({ example: '3 sleep mistakes that drain your energy' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @ApiPropertyOptional({ example: '{"scenes":[{"narration":"..."}]}' })
  @IsOptional()
  @IsString()
  content?: string;

  @ApiPropertyOptional({ example: 'A practical sleep tip for busy people.' })
  @IsOptional()
  @IsString()
  @MaxLength(4500)
  description?: string;

  @ApiPropertyOptional({ example: ['sleep', 'wellness', 'energy'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  hashtags?: string[];
}

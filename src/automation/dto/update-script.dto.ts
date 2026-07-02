import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateScriptDto {
  @ApiPropertyOptional({ example: '3 product mistakes buyers should avoid' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @ApiPropertyOptional({ example: '{"scenes":[{"narration":"..."}]}' })
  @IsOptional()
  @IsString()
  content?: string;

  @ApiPropertyOptional({ example: 'A practical product comparison note for busy buyers.' })
  @IsOptional()
  @IsString()
  @MaxLength(4500)
  description?: string;

  @ApiPropertyOptional({ example: ['affiliate', 'productreview', 'buyersguide'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  hashtags?: string[];
}

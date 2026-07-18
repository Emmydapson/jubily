import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class GenerateAiFromOfferDto {
  @ApiProperty({
    format: 'uuid',
    example: 'd766cd09-66f7-4a22-a8d5-2cf05a2dc7d4',
  })
  @IsUUID()
  offerId!: string;

  @ApiPropertyOptional({
    example: 'How to compare AI writing tools before buying',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  topic?: string;

  @ApiPropertyOptional({
    example:
      'Make it direct, beginner-friendly, and focused on a practical benefit.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  prompt?: string;
}

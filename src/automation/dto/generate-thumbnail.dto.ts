import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class GenerateThumbnailDto {
  @ApiPropertyOptional({
    example:
      'close-up of a person starting a healthy morning routine, bright high-contrast lighting, clean background, no text',
    description:
      'Optional override prompt. The backend will still enforce no text, no logos, central subject, and social-safe thumbnail constraints.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1500)
  prompt?: string;
}

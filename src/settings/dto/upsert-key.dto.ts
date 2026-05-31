/* eslint-disable prettier/prettier */
import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpsertKeyDto {
  @ApiProperty({
    example: 'sk_live_1234567890abcdef',
    minLength: 6,
    description: 'Plaintext integration API key. It is encrypted before storage.',
  })
  @IsString()
  @MinLength(6)
  key!: string;
}

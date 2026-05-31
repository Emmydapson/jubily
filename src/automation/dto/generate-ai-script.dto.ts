import { IsString, IsUUID, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GenerateAiScriptDto {
  @ApiProperty({
    example: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c',
    format: 'uuid',
    description: 'Topic ID that will receive the AI-generated script.',
  })
  @IsUUID()
  topicId!: string;

  @ApiProperty({
    example: 'Morning habits for more energy',
    minLength: 1,
    description: 'Topic text used by the AI script generator.',
  })
  @IsString()
  @MinLength(1)
  topic!: string;
}

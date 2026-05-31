import { IsString, IsUUID, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GenerateScriptDto {
  @ApiProperty({
    example: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c',
    format: 'uuid',
    description: 'Topic ID to attach the generated script to.',
  })
  @IsUUID()
  topicId!: string;

  @ApiProperty({
    example:
      'Open with a practical hook, explain the habit, then close with a clear call to action.',
    minLength: 1,
    description: 'Script content or prompt content to persist for the topic.',
  })
  @IsString()
  @MinLength(1)
  content!: string;
}

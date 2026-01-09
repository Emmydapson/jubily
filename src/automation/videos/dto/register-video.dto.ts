import { IsString, IsInt, IsIn } from 'class-validator';

export class RegisterVideoDto {
  @IsString()
  topicId: string;

  @IsString()
  scriptId: string;

  @IsString()
  videoUrl: string;

  @IsIn(['vertical', 'horizontal'])
  format: 'vertical' | 'horizontal';

  @IsInt()
  duration: number;
}

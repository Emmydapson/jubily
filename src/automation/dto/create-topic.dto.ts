import { IsInt, IsString, Min, Max } from 'class-validator';

export class CreateTopicDto {
  @IsString()
  title: string;

  @IsString()
  source: string;

  @IsInt()
  @Min(0)
  @Max(100)
  score: number;
}

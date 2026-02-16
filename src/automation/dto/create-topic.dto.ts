/* eslint-disable prettier/prettier */
import { IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class CreateTopicDto {
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  score?: number;
}

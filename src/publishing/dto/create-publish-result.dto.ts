import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export enum PublishStatus {
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

export class CreatePublishResultDto {
  @IsOptional()
  @IsString()
  jobId?: string;

  @IsString()
  @IsOptional()
  videoId?: string;

  @IsString()
  @IsNotEmpty()
  platform: string;

  @IsString()
  @IsNotEmpty()
  platformPostId: string;

  @IsEnum(PublishStatus)
  status: PublishStatus;

  @IsOptional()
  @IsString()
  errorMessage?: string;
}

import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

export class RegisterVideoDto {
  @IsString()
  jobId: string;

  @IsString()
  videoUrl: string;

  @IsOptional()
  @IsString()
  youtubeUrl?: string;

  @IsOptional()
  @IsIn(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'])
  status?: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

  @IsOptional()
  @IsBoolean()
  published?: boolean;
}

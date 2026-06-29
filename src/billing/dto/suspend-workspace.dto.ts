import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SuspendWorkspaceDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

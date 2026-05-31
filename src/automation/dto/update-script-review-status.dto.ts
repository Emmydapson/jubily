import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const SCRIPT_REVIEW_STATUSES = ['APPROVED', 'NEEDS_REVIEW', 'REJECTED'] as const;
export type ScriptReviewStatus = (typeof SCRIPT_REVIEW_STATUSES)[number];

export class UpdateScriptReviewStatusDto {
  @ApiPropertyOptional({
    enum: SCRIPT_REVIEW_STATUSES,
    example: 'APPROVED',
    description: 'Admin review decision. APPROVED allows automatic render and publish.',
  })
  @IsOptional()
  @IsIn(SCRIPT_REVIEW_STATUSES)
  reviewStatus?: ScriptReviewStatus;

  @ApiPropertyOptional({
    example: 'Approved after manual editorial review.',
    description: 'Optional admin review note stored in qualityReview.adminNote.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

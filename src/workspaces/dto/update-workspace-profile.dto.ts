import { Transform } from 'class-transformer';
import { ArrayUnique, IsArray, IsIn, IsOptional, IsString, IsUrl, Length, MinLength } from 'class-validator';
import {
  AFFILIATE_NICHES,
  AFFILIATE_PLATFORMS,
  normalizeAffiliateNiche,
  normalizeAffiliatePlatform,
} from '../../affiliates/affiliate.constants';

export class UpdateWorkspaceProfileDto {
  @IsOptional()
  @Transform(({ value }) => String(value || '').trim().toUpperCase())
  @IsString()
  @Length(2, 2)
  countryCode?: string;

  @IsOptional()
  @Transform(({ value }) => String(value || '').trim())
  @IsString()
  @MinLength(2)
  countryName?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @Transform(({ value }) => (Array.isArray(value) ? value.map((item) => normalizeAffiliateNiche(item) ?? item) : value))
  @IsIn(AFFILIATE_NICHES, { each: true })
  affiliateNiches?: string[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @Transform(({ value }) => (Array.isArray(value) ? value.map((item) => normalizeAffiliatePlatform(item) ?? item) : value))
  @IsIn(AFFILIATE_PLATFORMS, { each: true })
  affiliatePlatforms?: string[];

  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  primaryAffiliateLink?: string;

  @IsOptional()
  affiliateLinks?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  preferredContentTone?: string;

  @IsOptional()
  @IsString()
  preferredLanguage?: string;

  @IsOptional()
  @IsString()
  targetAudience?: string;

  @IsOptional()
  @IsString()
  contentGoal?: string;
}

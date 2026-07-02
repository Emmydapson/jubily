ALTER TABLE "Workspace"
ADD COLUMN "countryCode" TEXT,
ADD COLUMN "countryName" TEXT,
ADD COLUMN "affiliateNiches" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "affiliatePlatforms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "primaryAffiliateLink" TEXT,
ADD COLUMN "affiliateLinks" JSONB,
ADD COLUMN "preferredContentTone" TEXT,
ADD COLUMN "preferredLanguage" TEXT,
ADD COLUMN "targetAudience" TEXT,
ADD COLUMN "contentGoal" TEXT;

ALTER TABLE "Offer" ALTER COLUMN "network" SET DEFAULT 'DIGISTORE24';

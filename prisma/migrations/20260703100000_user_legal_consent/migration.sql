ALTER TABLE "User"
ADD COLUMN "acceptedTermsAt" TIMESTAMP(3),
ADD COLUMN "acceptedPrivacyPolicyAt" TIMESTAMP(3),
ADD COLUMN "termsVersion" TEXT,
ADD COLUMN "privacyPolicyVersion" TEXT;

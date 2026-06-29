-- Account lifecycle completion: email verification, password reset, refresh sessions.

ALTER TABLE "User"
ADD COLUMN "emailVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN "passwordChangedAt" TIMESTAMP(3);

UPDATE "User"
SET "emailVerified" = true,
    "emailVerifiedAt" = COALESCE("createdAt", CURRENT_TIMESTAMP)
WHERE "emailVerified" = false;

CREATE TABLE "EmailVerificationToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "rotatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key" ON "EmailVerificationToken"("tokenHash");
CREATE INDEX "EmailVerificationToken_userId_idx" ON "EmailVerificationToken"("userId");
CREATE INDEX "EmailVerificationToken_expiresAt_idx" ON "EmailVerificationToken"("expiresAt");

CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

CREATE UNIQUE INDEX "UserSession_refreshTokenHash_key" ON "UserSession"("refreshTokenHash");
CREATE INDEX "UserSession_userId_idx" ON "UserSession"("userId");
CREATE INDEX "UserSession_expiresAt_idx" ON "UserSession"("expiresAt");
CREATE INDEX "UserSession_revokedAt_idx" ON "UserSession"("revokedAt");

ALTER TABLE "EmailVerificationToken" ADD CONSTRAINT "EmailVerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'LOGIN_FAILED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'EMAIL_VERIFICATION_SENT';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'EMAIL_VERIFIED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PASSWORD_RESET_REQUESTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PASSWORD_RESET_COMPLETED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PASSWORD_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'REFRESH_TOKEN_ROTATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'LOGOUT';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'LOGOUT_ALL';

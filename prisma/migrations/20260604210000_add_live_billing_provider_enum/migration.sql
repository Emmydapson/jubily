CREATE TYPE "BillingProvider" AS ENUM ('PAYSTACK', 'STRIPE');

ALTER TABLE "WorkspaceSubscription"
  ALTER COLUMN "billingProvider" TYPE "BillingProvider"
  USING (
    CASE
      WHEN upper("billingProvider") = 'PAYSTACK' THEN 'PAYSTACK'::"BillingProvider"
      WHEN upper("billingProvider") = 'STRIPE' THEN 'STRIPE'::"BillingProvider"
      ELSE NULL
    END
  );

CREATE INDEX "WorkspaceSubscription_billingProvider_idx" ON "WorkspaceSubscription"("billingProvider");

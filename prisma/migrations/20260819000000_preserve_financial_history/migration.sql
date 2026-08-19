-- Preserve financial history when accounts/tenants are deleted
-- Changes onDelete from CASCADE to SET NULL on both FinancialHistory and PaymentRequest
-- Adds snapshot columns so records remain readable after account/tenant deletion

-- FinancialHistory: make accountId nullable, add snapshot columns
ALTER TABLE "FinancialHistory" ALTER COLUMN "accountId" DROP NOT NULL;
ALTER TABLE "FinancialHistory" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "FinancialHistory" ADD COLUMN IF NOT EXISTS "accountLogin" TEXT;
ALTER TABLE "FinancialHistory" ADD COLUMN IF NOT EXISTS "accountName" TEXT;

-- Change cascade: drop old FK, re-add with SET NULL
ALTER TABLE "FinancialHistory" DROP CONSTRAINT IF EXISTS "FinancialHistory_accountId_fkey";
ALTER TABLE "FinancialHistory" ADD CONSTRAINT "FinancialHistory_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "FinancialHistory_tenantId_idx" ON "FinancialHistory"("tenantId");

-- Backfill tenantId + snapshot from existing Account records
UPDATE "FinancialHistory" fh
SET
  "tenantId"     = a."tenantId",
  "accountLogin" = a."login",
  "accountName"  = a."name"
FROM "Account" a
WHERE fh."accountId" = a."id"
  AND fh."tenantId" IS NULL;

-- PaymentRequest: make accountId nullable, add snapshot columns
ALTER TABLE "PaymentRequest" ALTER COLUMN "accountId" DROP NOT NULL;
ALTER TABLE "PaymentRequest" ADD COLUMN IF NOT EXISTS "accountLogin" TEXT;
ALTER TABLE "PaymentRequest" ADD COLUMN IF NOT EXISTS "accountName" TEXT;

-- Change cascade: drop old FK, re-add with SET NULL
ALTER TABLE "PaymentRequest" DROP CONSTRAINT IF EXISTS "PaymentRequest_accountId_fkey";
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill snapshots on existing PaymentRequest records
UPDATE "PaymentRequest" pr
SET
  "accountLogin" = a."login",
  "accountName"  = a."name"
FROM "Account" a
WHERE pr."accountId" = a."id"
  AND pr."accountLogin" IS NULL;

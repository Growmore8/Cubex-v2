-- AlterTable: add credit settlement period and bonus expiry to Account
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "bonusExpiryAt"    TIMESTAMP(3);
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "creditSettleFrom" TIMESTAMP(3);
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "creditSettleTo"   TIMESTAMP(3);

-- AlterEnum: add CREDIT_REQUEST and CREDIT_CLEAR to PaymentKind
ALTER TYPE "PaymentKind" ADD VALUE IF NOT EXISTS 'CREDIT_REQUEST';
ALTER TYPE "PaymentKind" ADD VALUE IF NOT EXISTS 'CREDIT_CLEAR';

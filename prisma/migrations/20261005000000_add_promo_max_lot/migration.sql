-- Add promoCode to User (captured at registration)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "promoCode" TEXT;

-- Add maxLotSize to Account (per-account lot size cap)
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "maxLotSize" DECIMAL(10,2);

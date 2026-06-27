-- MT5 features: swap, commission, trailing stop, comment, stop limit, price alerts

-- Tenant: swap enabled toggle (SuperAdmin controls per tenant)
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "swapEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Account: swap-free flag (Islamic accounts)
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "swapFree" BOOLEAN NOT NULL DEFAULT false;

-- Symbol: swap rates and commission
ALTER TABLE "Symbol" ADD COLUMN IF NOT EXISTS "swapLong"         DECIMAL(10,5) NOT NULL DEFAULT 0;
ALTER TABLE "Symbol" ADD COLUMN IF NOT EXISTS "swapShort"        DECIMAL(10,5) NOT NULL DEFAULT 0;
ALTER TABLE "Symbol" ADD COLUMN IF NOT EXISTS "commissionPerLot" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- Trade (open positions): swap, commission, trailing stop, comment
ALTER TABLE "Trade" ADD COLUMN IF NOT EXISTS "trailingStop" DECIMAL(18,5) NOT NULL DEFAULT 0;
ALTER TABLE "Trade" ADD COLUMN IF NOT EXISTS "commission"   DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "Trade" ADD COLUMN IF NOT EXISTS "swap"         DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "Trade" ADD COLUMN IF NOT EXISTS "comment"      TEXT;

-- TradeHistory (closed positions): swap, commission, comment
ALTER TABLE "TradeHistory" ADD COLUMN IF NOT EXISTS "commission" DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "TradeHistory" ADD COLUMN IF NOT EXISTS "swap"       DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "TradeHistory" ADD COLUMN IF NOT EXISTS "comment"    TEXT;

-- PendingOrder: stop limit price, comment
ALTER TABLE "PendingOrder" ADD COLUMN IF NOT EXISTS "stopLimit" DECIMAL(18,8) NOT NULL DEFAULT 0;
ALTER TABLE "PendingOrder" ADD COLUMN IF NOT EXISTS "comment"   TEXT;

-- PriceAlert: new table
CREATE TABLE IF NOT EXISTS "PriceAlert" (
    "id"        TEXT NOT NULL,
    "tenantId"  TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "symbol"    TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "price"     DECIMAL(18,5) NOT NULL,
    "note"      TEXT,
    "triggered" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PriceAlert_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PriceAlert_accountId_idx" ON "PriceAlert"("accountId");
CREATE INDEX IF NOT EXISTS "PriceAlert_tenantId_idx"  ON "PriceAlert"("tenantId");
ALTER TABLE "PriceAlert" ADD CONSTRAINT "PriceAlert_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

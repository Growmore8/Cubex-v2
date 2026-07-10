-- Group-level swap and commission controls (MT5-style group overrides)
ALTER TABLE "TradeGroup"
  ADD COLUMN IF NOT EXISTS "swapEnabled"      BOOLEAN        NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "swapMultiplier"   DECIMAL(6,3)   NOT NULL DEFAULT 1.000,
  ADD COLUMN IF NOT EXISTS "commissionPerLot" DECIMAL(10,2)  NOT NULL DEFAULT -1.00;

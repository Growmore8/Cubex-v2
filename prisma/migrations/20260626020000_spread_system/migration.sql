-- Add markup column to Symbol table
ALTER TABLE "Symbol" ADD COLUMN IF NOT EXISTS "markup" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- Add spreadOverride to AccountSymbolOverride
ALTER TABLE "AccountSymbolOverride" ADD COLUMN IF NOT EXISTS "spreadOverride" DECIMAL(10,2);

-- Add per-symbol spread overrides for TradeGroup
CREATE TABLE IF NOT EXISTS "TradeGroupSymbolOverride" (
    "id"      TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "symbol"  TEXT NOT NULL,
    "spread"  DECIMAL(10,2) NOT NULL,
    CONSTRAINT "TradeGroupSymbolOverride_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TradeGroupSymbolOverride_groupId_symbol_key" UNIQUE ("groupId", "symbol"),
    CONSTRAINT "TradeGroupSymbolOverride_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TradeGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "TradeGroupSymbolOverride_groupId_idx" ON "TradeGroupSymbolOverride"("groupId");

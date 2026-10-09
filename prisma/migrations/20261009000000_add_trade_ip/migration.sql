-- Add client IP tracking to Trade and TradeHistory
-- ip is null for admin/server-placed trades; populated only when client places via client API
ALTER TABLE "Trade" ADD COLUMN IF NOT EXISTS "ip" TEXT;
ALTER TABLE "TradeHistory" ADD COLUMN IF NOT EXISTS "ip" TEXT;
-- closeIp: IP when client manually closes a trade; null for admin/TP/SL/MC closes
ALTER TABLE "TradeHistory" ADD COLUMN IF NOT EXISTS "closeIp" TEXT;

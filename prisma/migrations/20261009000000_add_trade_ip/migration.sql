-- Add client IP tracking to Trade and TradeHistory
-- ip is null for admin/server-placed trades; populated only when client places via client API
ALTER TABLE "Trade" ADD COLUMN "ip" TEXT;
ALTER TABLE "TradeHistory" ADD COLUMN "ip" TEXT;

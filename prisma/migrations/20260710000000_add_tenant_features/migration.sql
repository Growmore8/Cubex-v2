-- Add features JSON column for per-tenant feature flags (copyTrading, etc.)
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "features" JSONB NOT NULL DEFAULT '{}';

-- AlterTable: Symbol - add spreadType and spreadMax for floating spread support
ALTER TABLE "Symbol" ADD COLUMN IF NOT EXISTS "spreadType" TEXT NOT NULL DEFAULT 'FIXED';
ALTER TABLE "Symbol" ADD COLUMN IF NOT EXISTS "spreadMax" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- AlterTable: Account - add spreadMarkup for per-account spread override
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "spreadMarkup" DECIMAL(10,2) NOT NULL DEFAULT 0;

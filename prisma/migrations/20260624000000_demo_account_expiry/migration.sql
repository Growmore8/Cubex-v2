-- AlterTable: add expiresAt to Account (DEMO only)
ALTER TABLE "Account" ADD COLUMN "expiresAt" TIMESTAMP(3);

-- CreateIndex for fast daily cron query
CREATE INDEX "Account_expiresAt_idx" ON "Account"("expiresAt");

-- CreateTable: permanent history of expired demo accounts
CREATE TABLE "ExpiredAccount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tenantName" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "clientEmail" TEXT,
    "login" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'DEMO',
    "balance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "expiredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpiredAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExpiredAccount_tenantId_idx" ON "ExpiredAccount"("tenantId");
CREATE INDEX "ExpiredAccount_expiredAt_idx" ON "ExpiredAccount"("expiredAt");

-- AddForeignKey
ALTER TABLE "ExpiredAccount" ADD CONSTRAINT "ExpiredAccount_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

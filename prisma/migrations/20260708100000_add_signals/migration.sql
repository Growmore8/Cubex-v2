-- CreateTable
CREATE TABLE "Signal" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "direction" "Side" NOT NULL,
    "entryPrice" DECIMAL(18,5) NOT NULL,
    "sl" DECIMAL(18,5) NOT NULL DEFAULT 0,
    "tp" DECIMAL(18,5) NOT NULL DEFAULT 0,
    "rationale" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Signal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Signal_tenantId_active_idx" ON "Signal"("tenantId", "active");

-- AddForeignKey
ALTER TABLE "Signal" ADD CONSTRAINT "Signal_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

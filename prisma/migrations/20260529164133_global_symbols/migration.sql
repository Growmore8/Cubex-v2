-- AlterTable
ALTER TABLE "Symbol" ADD COLUMN     "feed" TEXT;

-- CreateTable
CREATE TABLE "GlobalSymbol" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "display" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'forex',
    "digits" INTEGER NOT NULL DEFAULT 5,
    "feed" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GlobalSymbol_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GlobalSymbol_symbol_key" ON "GlobalSymbol"("symbol");

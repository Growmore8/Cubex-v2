-- Add optional GTD expiry timestamp to PendingOrder
ALTER TABLE "PendingOrder" ADD COLUMN "expiresAt" TIMESTAMP(3);

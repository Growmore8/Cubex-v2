-- AlterEnum: add STOP_OUT value to CloseReason
-- Note: ALTER TYPE ADD VALUE cannot run inside a transaction on PostgreSQL < 12.
-- On PostgreSQL 12+ this is safe inside a transaction. The IF NOT EXISTS guard
-- makes it idempotent so re-running the migration is always safe.
ALTER TYPE "CloseReason" ADD VALUE IF NOT EXISTS 'STOP_OUT';

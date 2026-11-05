-- Performance indexes: covers manager-scoped desk queries, trade sort, history sort, audit filter+sort

-- Account: manager-scoped desk queries (every staff desk view filters by tenantId+managerId)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Account_tenantId_managerId_idx" ON "Account"("tenantId", "managerId");

-- Account: lookups by userId across services
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Account_userId_idx" ON "Account"("userId");

-- Account: type-filtered queries (seat counts, LIVE/DEMO splits)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Account_tenantId_type_idx" ON "Account"("tenantId", "type");

-- Trade: covers accountId filter + openedAt sort (listOpen order by openedAt desc)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Trade_accountId_openedAt_idx" ON "Trade"("accountId", "openedAt" DESC);

-- TradeHistory: covers accountId filter + closedAt sort (listHistory order by closedAt desc)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "TradeHistory_accountId_closedAt_idx" ON "TradeHistory"("accountId", "closedAt" DESC);

-- AuditLog: covers tenantId filter + createdAt sort (listAudit where tenantId order by createdAt desc)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt" DESC);

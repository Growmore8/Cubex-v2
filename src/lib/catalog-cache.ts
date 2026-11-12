import { prisma } from "@/lib/prisma";

// Global symbol catalog — only changes when superadmin seeds or admin disables.
let _symCache: { data: any[]; exp: number } | null = null;
export async function getCachedGlobalSymbols() {
  if (_symCache && Date.now() < _symCache.exp) return _symCache.data;
  const data = await prisma.globalSymbol.findMany({
    where: { enabled: true },
    orderBy: { symbol: "asc" },
    select: { symbol: true, display: true, category: true, digits: true, feed: true },
  });
  _symCache = { data, exp: Date.now() + 60_000 };
  return data;
}
export function invalidateGlobalSymbolCache() { _symCache = null; }

// Per-tenant full object — brand + features in one cached call.
const _tenantCache = new Map<string, { data: any; exp: number }>();
export async function getCachedTenantById(id: string) {
  const hit = _tenantCache.get(id);
  if (hit && Date.now() < hit.exp) return hit.data;
  const data = await prisma.tenant.findUnique({
    where: { id },
    select: {
      name: true, brandName: true, logoUrl: true, primaryColor: true,
      accentColor: true, swapEnabled: true, features: true,
    },
  });
  _tenantCache.set(id, { data, exp: Date.now() + 60_000 });
  return data;
}
export function invalidateTenantByIdCache(id: string) { _tenantCache.delete(id); }

// Per-tenant symbol spreads — cache 30s (changes when admin edits spreads).
const _spreadCache = new Map<string, { data: any[]; exp: number }>();
export async function getCachedTenantSpreads(tenantId: string) {
  const hit = _spreadCache.get(tenantId);
  if (hit && Date.now() < hit.exp) return hit.data;
  const data = await prisma.symbol.findMany({
    where: { tenantId },
    select: { symbol: true, spread: true, spreadType: true, spreadMax: true, category: true },
  });
  _spreadCache.set(tenantId, { data, exp: Date.now() + 30_000 });
  return data;
}
export function invalidateSpreadCache(tenantId: string) { _spreadCache.delete(tenantId); }

// Per-tenant subscription status — cache 60s.
const _subCache = new Map<string, { data: any; exp: number }>();
export async function getCachedSubscription(tenantId: string) {
  const hit = _subCache.get(tenantId);
  if (hit && Date.now() < hit.exp) return hit.data;
  const data = await prisma.subscription.findUnique({
    where: { tenantId },
    select: { status: true, endsAt: true },
  });
  _subCache.set(tenantId, { data, exp: Date.now() + 60_000 });
  return data;
}

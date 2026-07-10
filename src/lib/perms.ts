import { prisma } from "@/lib/prisma";

let modeCache = { v: "OPEN", t: 0 };

export async function getPlatformMode(): Promise<string> {
  if (Date.now() - modeCache.t < 4000) return modeCache.v;
  try {
    const setting = await prisma.setting.findUnique({ where: { key: "platform" } });
    modeCache = { v: (setting && (setting.value as any) && (setting.value as any).mode) || "OPEN", t: Date.now() };
  } catch (e) { modeCache = { v: "OPEN", t: Date.now() }; }
  return modeCache.v;
}

export async function assertTradingOpen() {
  const mode = await getPlatformMode();
  if (mode !== "OPEN") throw new Error("Trading is currently disabled by the platform (" + mode + ")");
}

export async function can(s: any, key: string): Promise<boolean> {
  if (!s) return false;
  if (s.role === "SUPERADMIN") return true;
  if (s.tenantId) {
    try {
      const t = await prisma.tenant.findUnique({ where: { id: s.tenantId }, select: { permissions: true } });
      const tp: any = (t && t.permissions) || {};
      if (tp[key] === false) return false;
    } catch (e) {}
  }
  if (s.role === "MANAGER") {
    try {
      const u = await prisma.user.findUnique({ where: { id: s.sub }, select: { perms: true } });
      const up: any = (u && u.perms) || {};
      if (up[key] === false) return false;
    } catch (e) {}
  }
  return true;
}

export async function assertCan(s: any, key: string) {
  if (!(await can(s, key))) throw new Error("Permission denied for this action");
}

// Master list of permission keys (kept in sync with the SuperAdmin tenant
// permissions UI). Used to compute an effective permission map for the client.
export const PERM_KEYS = [
  "createClients", "deleteClients", "manageManagers",
  "processDeposits", "processWithdrawals", "creditBonus", "transferFunds", "editFinancial", "deleteFinancial",
  "manualTrade", "closeTrades", "editTrades", "deleteTrades",
  "viewAudit", "exportPdf", "sendNotifications",
  "editSpread",
  // Feature-flag mirrors — admin can restrict per manager (SA sets the tenant ceiling)
  "copyTrading", "advancedAnalytics", "marketNewsFeed", "economicCalendar", "referralProgram",
] as const;

// Resolve every permission key to a final boolean for this session, applying the
// tenant-level gate and (for managers) the per-manager gate. Default is allow.
export async function effectivePerms(s: any): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  if (!s) { for (const k of PERM_KEYS) out[k] = false; return out; }
  if (s.role === "SUPERADMIN") { for (const k of PERM_KEYS) out[k] = true; return out; }
  let tp: any = {}, up: any = {};
  try {
    if (s.tenantId) {
      const t = await prisma.tenant.findUnique({ where: { id: s.tenantId }, select: { permissions: true } });
      tp = (t && t.permissions) || {};
    }
    if (s.role === "MANAGER") {
      const u = await prisma.user.findUnique({ where: { id: s.sub }, select: { perms: true } });
      up = (u && u.perms) || {};
    }
  } catch (e) {}
  for (const k of PERM_KEYS) out[k] = tp[k] !== false && up[k] !== false;
  return out;
}
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
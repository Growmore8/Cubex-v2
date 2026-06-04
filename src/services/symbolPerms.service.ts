import { prisma } from "@/lib/prisma";
import type { SessionPayload } from "@/types";

// Symbol on/off permissions:
//  - Tenant-level (set by ADMIN): hides a symbol across the ENTIRE tenant.
//  - Manager-level (set by MANAGER): hides a symbol only for that manager's own clients.
// Stored in the Setting model as JSON arrays.

const tKey = (tenantId: string) => `symdis:t:${tenantId}`;
const mKey = (managerId: string) => `symdis:m:${managerId}`;

async function readList(key: string): Promise<string[]> {
  try {
    const s = await prisma.setting.findUnique({ where: { key } });
    const v: any = s?.value;
    return Array.isArray(v?.symbols) ? v.symbols : [];
  } catch { return []; }
}
async function writeList(key: string, symbols: string[]) {
  await prisma.setting.upsert({ where: { key }, create: { key, value: { symbols } }, update: { value: { symbols } } });
}

export const getTenantDisabled = (tenantId: string) => readList(tKey(tenantId));
export const setTenantDisabled = (tenantId: string, symbols: string[]) => writeList(tKey(tenantId), symbols);
export const getManagerDisabled = (managerId: string) => readList(mKey(managerId));
export const setManagerDisabled = (managerId: string, symbols: string[]) => writeList(mKey(managerId), symbols);

// Resolve the set of symbols that should be HIDDEN for the given session context.
export async function getDisabledSetFor(session: SessionPayload): Promise<Set<string>> {
  const hidden = new Set<string>();
  if (!session.tenantId) return hidden; // superadmin/global: no filtering

  // Tenant-level (applies to everyone in the tenant)
  for (const s of await getTenantDisabled(session.tenantId)) hidden.add(s);

  if (session.role === "MANAGER") {
    for (const s of await getManagerDisabled(session.sub)) hidden.add(s);
  } else if (session.role === "CLIENT") {
    // Union of every manager assigned to this client's accounts
    const accs = await prisma.account.findMany({ where: { tenantId: session.tenantId, userId: session.sub }, select: { managerId: true } });
    const mgrIds = Array.from(new Set(accs.map((a) => a.managerId).filter(Boolean) as string[]));
    for (const mid of mgrIds) for (const s of await getManagerDisabled(mid)) hidden.add(s);
  }
  return hidden;
}

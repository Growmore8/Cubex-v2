import { prisma } from "@/lib/prisma";

// Per-tenant setting: when ON, clients may only withdraw/transfer their PROFIT
// (PNL) balance — not the full balance. Admin terminal is never capped.
const key = (tenantId: string) => `funds:pnlonly:${tenantId}`;

export async function getFundsPnlOnly(tenantId: string): Promise<boolean> {
  try {
    const s = await prisma.setting.findUnique({ where: { key: key(tenantId) } });
    return !!(s?.value as any)?.on;
  } catch { return false; }
}
export async function setFundsPnlOnly(tenantId: string, on: boolean) {
  await prisma.setting.upsert({ where: { key: key(tenantId) }, create: { key: key(tenantId), value: { on } }, update: { value: { on } } });
}

// Max amount a client may move given the setting. PNL-only => positive pnl only.
export function withdrawableBalance(acc: { deposit: any; withdrawal: any; credit: any; bonus: any; pnl: any }, pnlOnly: boolean): number {
  const balance = Number(acc.deposit) + Number(acc.pnl) - Number(acc.withdrawal);
  if (!pnlOnly) return balance;
  return Math.max(0, Number(acc.pnl));
}

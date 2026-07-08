import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { pipForDigits } from "@/lib/spread";
import { contractSize } from "@/lib/trademath";
import { audit } from "@/lib/audit";

export interface RolloverResult {
  date: string;
  multiplier: number;
  tenantsProcessed: number;
  tradesCharged: number;
  errors: string[];
}

// Wednesday = day 3 (UTC). Forex rollover convention: 3× swap on Wednesday
// to compensate for Friday settlement rolling over the weekend.
export function swapMultiplier(date: Date): number {
  return date.getUTCDay() === 3 ? 3 : 1;
}

export async function runSwapRollover(tenantIdFilter?: string): Promise<RolloverResult> {
  const now = new Date();
  const mult = swapMultiplier(now);
  const dateStr = now.toISOString().slice(0, 10);
  let totalTrades = 0;
  let totalTenants = 0;
  const errors: string[] = [];

  const where: any = { swapEnabled: true };
  if (tenantIdFilter) where.id = tenantIdFilter;

  const tenants = await prisma.tenant.findMany({
    where,
    select: { id: true, name: true },
  });

  for (const tenant of tenants) {
    try {
      const trades = await prisma.trade.findMany({
        where: { account: { tenantId: tenant.id } },
        include: { account: { select: { swapFree: true, id: true } } },
      });
      if (!trades.length) continue;

      const symbols = await prisma.symbol.findMany({
        where: { tenantId: tenant.id },
        select: { symbol: true, digits: true, swapLong: true, swapShort: true },
      });
      const symMap = new Map(symbols.map((s) => [s.symbol, s]));

      const globalSyms = await prisma.globalSymbol.findMany({
        where: { symbol: { in: [...new Set(trades.map((t) => t.symbol))] } },
        select: { symbol: true, digits: true },
      });
      const globalDigits = new Map(globalSyms.map((s) => [s.symbol, s.digits]));

      let tenantCount = 0;
      const accountDeltas = new Map<string, number>();

      for (const trade of trades) {
        if (trade.account.swapFree) continue;

        const sym = symMap.get(trade.symbol);
        const swapRate = sym
          ? Number(trade.type === "BUY" ? sym.swapLong : sym.swapShort)
          : 0;
        if (swapRate === 0) continue;

        const digits = sym?.digits ?? globalDigits.get(trade.symbol) ?? 5;
        const pip = pipForDigits(digits);
        const cs = contractSize(trade.symbol);
        const swapAmount = swapRate * pip * Number(trade.lots) * cs * mult;
        if (swapAmount === 0) continue;

        await prisma.trade.update({
          where: { id: trade.id },
          data: { swap: { increment: new Prisma.Decimal(swapAmount) } },
        });

        accountDeltas.set(trade.account.id, (accountDeltas.get(trade.account.id) ?? 0) + swapAmount);
        tenantCount++;
      }

      for (const [accountId, delta] of accountDeltas) {
        await prisma.account.update({
          where: { id: accountId },
          data: { pnl: { increment: new Prisma.Decimal(delta) } },
        });
      }

      if (tenantCount > 0) {
        audit(tenant.id, "swap.rollover", `Rollover ${dateStr}: ${tenantCount} trades (×${mult})`, "system").catch(() => {});
        totalTrades += tenantCount;
        totalTenants++;
      }
    } catch (e: any) {
      errors.push(`${tenant.name}: ${e.message}`);
    }
  }

  return { date: dateStr, multiplier: mult, tenantsProcessed: totalTenants, tradesCharged: totalTrades, errors };
}

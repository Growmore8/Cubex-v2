import { NextResponse } from "next/server";
import { requireAdminOrManager } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { emitRefresh } from "@/lib/realtime";
import { assertCan } from "@/lib/perms";
import { Redis } from "ioredis";

async function getAccount(tenantId: string, id: string, managerSub?: string) {
  const acc = await prisma.account.findFirst({ where: { id, tenantId } });
  if (!acc) return null;
  if (managerSub && (acc.managerId || null) !== managerSub) return null;
  return acc;
}

async function pubSpreads() {
  try {
    const pub = new Redis(process.env.REDIS_URL || "redis://localhost:6379");
    await pub.publish("cubex:spreads", "1");
    pub.disconnect();
  } catch (_) {}
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireAdminOrManager();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const managerSub = s.role === "MANAGER" ? s.sub : undefined;
  const acc = await getAccount(s.tenantId!, id, managerSub);
  if (!acc) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  const overrides = await prisma.accountSymbolOverride.findMany({ where: { accountId: acc.id } });
  const disabled = overrides.filter((o) => o.disabled).map((o) => o.symbol);
  const spreadOverrides: Record<string, number> = {};
  for (const o of overrides) {
    if (o.spreadOverride !== null && o.spreadOverride !== undefined) {
      spreadOverrides[o.symbol] = Number(o.spreadOverride);
    }
  }
  return NextResponse.json({ ok: true, disabled, spreadOverrides });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireAdminOrManager();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const b = await req.json();
    const symbol = String(b.symbol || "").trim();
    if (!symbol) throw new Error("Symbol required");
    const managerSub = s.role === "MANAGER" ? s.sub : undefined;
    const acc = await getAccount(s.tenantId!, id, managerSub);
    if (!acc) throw new Error("Account not found or not your client");

    // ── Spread override ──────────────────────────────────────────────────────
    if (b.spreadOverride !== undefined) {
      await assertCan(s, "editSpread");
      if (b.spreadOverride === null) {
        // Remove override — clear field only (keep disabled flag)
        await prisma.accountSymbolOverride.updateMany({
          where: { accountId: acc.id, symbol },
          data: { spreadOverride: null },
        });
      } else {
        const pips = Math.max(0, Number(b.spreadOverride) || 0);
        await prisma.accountSymbolOverride.upsert({
          where: { accountId_symbol: { accountId: acc.id, symbol } },
          create: { accountId: acc.id, symbol, disabled: false, spreadOverride: pips },
          update: { spreadOverride: pips },
        });
      }
      await audit(s.tenantId!, "client.spreadOverride", `${acc.login} ${symbol} spread=${b.spreadOverride ?? "default"}`, s.email);
      await pubSpreads();
      emitRefresh({ kind: "symbols", scope: "account", accountId: acc.id });
      return NextResponse.json({ ok: true });
    }

    // ── Symbol disable/enable ────────────────────────────────────────────────
    const disabled = !!b.disabled;
    if (disabled) {
      await prisma.accountSymbolOverride.upsert({
        where: { accountId_symbol: { accountId: acc.id, symbol } },
        update: { disabled: true },
        create: { accountId: acc.id, symbol, disabled: true },
      });
    } else {
      await prisma.accountSymbolOverride.updateMany({
        where: { accountId: acc.id, symbol },
        data: { disabled: false },
      });
    }
    await audit(s.tenantId!, "client.symbolOverride", acc.login + " " + symbol + (disabled ? " disabled" : " enabled"), s.email);
    emitRefresh({ kind: "symbols", scope: "account", accountId: acc.id });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}

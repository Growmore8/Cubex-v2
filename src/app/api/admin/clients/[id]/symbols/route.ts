import { NextResponse } from "next/server";
import { requireAdminOrManager } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { emitRefresh } from "@/lib/realtime";

async function getAccount(tenantId: string, id: string, managerSub?: string) {
  const acc = await prisma.account.findFirst({ where: { id, tenantId } });
  if (!acc) return null;
  // Manager can only access their own clients
  if (managerSub && (acc.managerId || null) !== managerSub) return null;
  return acc;
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
  return NextResponse.json({ ok: true, disabled });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireAdminOrManager();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const b = await req.json();
    const symbol = String(b.symbol || "").trim();
    if (!symbol) throw new Error("Symbol required");
    const disabled = !!b.disabled;
    const managerSub = s.role === "MANAGER" ? s.sub : undefined;
    const acc = await getAccount(s.tenantId!, id, managerSub);
    if (!acc) throw new Error("Account not found or not your client");
    if (disabled) {
      await prisma.accountSymbolOverride.upsert({
        where: { accountId_symbol: { accountId: acc.id, symbol } },
        update: { disabled: true },
        create: { accountId: acc.id, symbol, disabled: true },
      });
    } else {
      await prisma.accountSymbolOverride.deleteMany({ where: { accountId: acc.id, symbol } });
    }
    await audit(s.tenantId!, "client.symbolOverride", acc.login + " " + symbol + (disabled ? " disabled" : " enabled"), s.email);
    emitRefresh({ kind: "symbols", scope: "account", accountId: acc.id });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}

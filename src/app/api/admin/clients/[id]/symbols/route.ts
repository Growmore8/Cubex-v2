import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const acc = await prisma.account.findFirst({ where: { id: params.id, tenantId: s.tenantId! } });
  if (!acc) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  const overrides = await prisma.accountSymbolOverride.findMany({ where: { accountId: acc.id } });
  const disabled = overrides.filter((o) => o.disabled).map((o) => o.symbol);
  return NextResponse.json({ ok: true, disabled });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const b = await req.json();
    const symbol = String(b.symbol || "").trim();
    if (!symbol) throw new Error("Symbol required");
    const disabled = !!b.disabled;
    const acc = await prisma.account.findFirst({ where: { id: params.id, tenantId: s.tenantId! } });
    if (!acc) throw new Error("Account not found");
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
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}
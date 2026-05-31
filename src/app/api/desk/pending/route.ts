import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { assertTradingOpen, assertCan } from "@/lib/perms";
import { audit } from "@/lib/audit";

export async function POST(req: Request) {
  const s = await requireStaff();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    await assertTradingOpen();
    await assertCan(s, "manualTrade");
    const b = await req.json();
    const a: any = await prisma.account.findUnique({ where: { id: b.accountId } });
    if (!a) throw new Error("Account not found");
    if (s.role !== "SUPERADMIN" && a.tenantId !== s.tenantId) throw new Error("Forbidden");
    if (s.role === "MANAGER" && a.managerId !== s.sub) throw new Error("Not your account");
    if (a.locked) throw new Error("Account is locked");
    const lots = Number(b.lots); const price = Number(b.price);
    if (!lots || lots <= 0) throw new Error("Invalid lots");
    if (!price || price <= 0) throw new Error("Invalid trigger price");
    const side = b.side === "SELL" ? "SELL" : "BUY";
    const kind = b.kind === "STOP" ? "STOP" : "LIMIT";
    await prisma.pendingOrder.create({ data: { tenantId: a.tenantId, accountId: a.id, symbol: b.symbol, side: side as any, kind, lots, price, sl: Number(b.sl) || 0, tp: Number(b.tp) || 0 } });
    await audit(a.tenantId, "desk.pending", a.login + " " + side + " " + kind + " " + b.symbol + " @ " + price, s.email);
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 }); }
}
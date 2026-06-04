import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

async function allowed(tenantId: string): Promise<boolean> {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { permissions: true } });
  return !!((t && (t.permissions as any)) || {}).ownPaymentMethods;
}

export async function GET() {
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const can = await allowed(s.tenantId!);
  // global defaults are shown read-only so the admin knows what clients already see
  const own = await prisma.cryptoWallet.findMany({ where: { tenantId: s.tenantId! }, orderBy: { createdAt: "asc" } });
  const globals = await prisma.cryptoWallet.findMany({ where: { tenantId: null, active: true }, orderBy: { createdAt: "asc" } });
  return NextResponse.json({ ok: true, allowed: can, own, globals });
}

export async function POST(req: Request) {
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    if (!(await allowed(s.tenantId!))) throw new Error("Your plan does not allow adding payment methods");
    const b = await req.json();
    const type = (b.type || "CRYPTO").toUpperCase();
    const data = {
      type,
      network: type === "CRYPTO" ? (b.network || "BEP20") : "",
      asset: b.asset || "USDT",
      address: b.address || "",
      label: b.label || null,
      url: b.url || null,
      active: b.active !== false,
    };
    if (b.action === "add") {
      if (type === "CRYPTO" && !data.address) throw new Error("Address required");
      if (type === "UPI" && !data.address) throw new Error("UPI id required");
      if (type === "LINK" && !data.url) throw new Error("Link URL required");
      await prisma.cryptoWallet.create({ data: { ...data, tenantId: s.tenantId! } });
    } else if (b.action === "update") {
      // scope the update to this tenant so an admin can't touch globals/other tenants
      const existing = await prisma.cryptoWallet.findUnique({ where: { id: b.id } });
      if (!existing || existing.tenantId !== s.tenantId) throw new Error("Not found");
      await prisma.cryptoWallet.update({ where: { id: b.id }, data });
    } else if (b.action === "delete") {
      const existing = await prisma.cryptoWallet.findUnique({ where: { id: b.id } });
      if (!existing || existing.tenantId !== s.tenantId) throw new Error("Not found");
      await prisma.cryptoWallet.delete({ where: { id: b.id } });
    } else throw new Error("Unknown action");
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 }); }
}

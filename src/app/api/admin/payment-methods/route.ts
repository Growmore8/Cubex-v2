import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { buildWalletData, assertWalletValid, walletAddedBy } from "@/lib/paymentMethod";

async function allowed(tenantId: string): Promise<boolean> {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { permissions: true } });
  return !!((t && (t.permissions as any)) || {}).ownPaymentMethods;
}

export async function GET() {
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const can = await allowed(s.tenantId!);
  // Tenant admin sees only rows they manage (_addedBy = "tenant" or legacy untagged).
  // SA-custom rows (_addedBy = "sa") are managed by SA only.
  const allOwn = await prisma.cryptoWallet.findMany({ where: { tenantId: s.tenantId! }, orderBy: { createdAt: "asc" } });
  const own = allOwn.filter((w) => walletAddedBy(w) === "tenant");
  const globals = await prisma.cryptoWallet.findMany({ where: { tenantId: null, active: true }, orderBy: { createdAt: "asc" } });
  return NextResponse.json({ ok: true, allowed: can, own, globals });
}

export async function POST(req: Request) {
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    if (!(await allowed(s.tenantId!))) throw new Error("Your plan does not allow adding payment methods");
    const b = await req.json();
    const data = buildWalletData(b, "tenant");
    if (b.action === "add") {
      assertWalletValid(data);
      await prisma.cryptoWallet.create({ data: { ...data, tenantId: s.tenantId! } });
    } else if (b.action === "update") {
      const existing = await prisma.cryptoWallet.findUnique({ where: { id: b.id } });
      if (!existing || existing.tenantId !== s.tenantId) throw new Error("Not found");
      // Only allow editing rows the tenant admin owns (not SA-configured ones)
      if (walletAddedBy(existing) === "sa") throw new Error("This method is managed by your platform provider");
      assertWalletValid(data);
      await prisma.cryptoWallet.update({ where: { id: b.id }, data });
    } else if (b.action === "delete") {
      const existing = await prisma.cryptoWallet.findUnique({ where: { id: b.id } });
      if (!existing || existing.tenantId !== s.tenantId) throw new Error("Not found");
      if (walletAddedBy(existing) === "sa") throw new Error("This method is managed by your platform provider");
      await prisma.cryptoWallet.delete({ where: { id: b.id } });
    } else throw new Error("Unknown action");
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 }); }
}

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

// scope: "global" => tenantId null (default for all tenants); else a tenant id.
function scopeToTenantId(scope: string | null): string | null {
  return !scope || scope === "global" ? null : scope;
}

export async function GET(req: Request) {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const scope = url.searchParams.get("scope");
  const tenantId = scopeToTenantId(scope);
  const wallets = await prisma.cryptoWallet.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } });
  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true, brandName: true, permissions: true }, orderBy: { name: "asc" } });
  // legacy single-URL local payment setting (kept for back-compat, shows as a LINK method)
  const setting = await prisma.setting.findUnique({ where: { key: "payments" } }).catch(() => null);
  return NextResponse.json({
    ok: true,
    wallets,
    xynder: (setting && setting.value) || {},
    tenants: tenants.map((t) => ({ id: t.id, name: t.brandName || t.name, ownPaymentMethods: !!((t.permissions as any) || {}).ownPaymentMethods })),
  });
}

export async function POST(req: Request) {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const b = await req.json();
    if (b.kind === "wallet") {
      const tenantId = scopeToTenantId(b.scope);
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
        await prisma.cryptoWallet.create({ data: { ...data, tenantId } });
      } else if (b.action === "update") {
        await prisma.cryptoWallet.update({ where: { id: b.id }, data });
      } else if (b.action === "delete") {
        await prisma.cryptoWallet.delete({ where: { id: b.id } });
      } else throw new Error("Unknown action");
    } else if (b.kind === "perm") {
      // toggle whether a tenant admin may add their own payment methods
      const t = await prisma.tenant.findUnique({ where: { id: b.tenantId }, select: { permissions: true } });
      const perms: any = (t && t.permissions) || {};
      perms.ownPaymentMethods = !!b.allow;
      await prisma.tenant.update({ where: { id: b.tenantId }, data: { permissions: perms } });
    } else if (b.kind === "xynder") {
      await prisma.setting.upsert({ where: { key: "payments" }, create: { key: "payments", value: { url: b.url || "", active: !!b.active } }, update: { value: { url: b.url || "", active: !!b.active } } });
    } else throw new Error("Unknown kind");
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 }); }
}

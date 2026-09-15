import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { buildWalletData, assertWalletValid, walletAddedBy } from "@/lib/paymentMethod";

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
  // When viewing a specific tenant, filter by addedBy so SA-custom and tenant-managed don't mix.
  // "sa" → only rows tagged _addedBy:"sa"; "tenant" → rows with no tag or _addedBy:"tenant".
  // Global scope (tenantId=null) always shows all rows.
  const addedByFilter = url.searchParams.get("addedBy"); // "sa" | "tenant" | null
  const allRows = await prisma.cryptoWallet.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } });
  const wallets = (tenantId && addedByFilter)
    ? allRows.filter((w) => walletAddedBy(w) === addedByFilter)
    : allRows;
  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true, brandName: true, permissions: true }, orderBy: { name: "asc" } });
  // legacy single-URL local payment setting (kept for back-compat, shows as a LINK method)
  const setting = await prisma.setting.findUnique({ where: { key: "payments" } }).catch(() => null);
  return NextResponse.json({
    ok: true,
    wallets,
    xynder: (setting && setting.value) || {},
    tenants: tenants.map((t) => ({ id: t.id, name: t.brandName || t.name, ownPaymentMethods: !!((t.permissions as any) || {}).ownPaymentMethods, paymentMethodSource: ((t.permissions as any) || {}).paymentMethodSource || null })),
  });
}

export async function POST(req: Request) {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const b = await req.json();
    if (b.kind === "wallet") {
      const tenantId = scopeToTenantId(b.scope);
      // Tag per-tenant SA rows so they stay separate from tenant-admin rows.
      // Global rows (tenantId=null) need no tag.
      const data = buildWalletData(b, tenantId ? "sa" : undefined);
      if (b.action === "add") {
        assertWalletValid(data);
        await prisma.cryptoWallet.create({ data: { ...data, tenantId } });
      } else if (b.action === "update") {
        assertWalletValid(data);
        await prisma.cryptoWallet.update({ where: { id: b.id }, data });
      } else if (b.action === "delete") {
        await prisma.cryptoWallet.delete({ where: { id: b.id } });
      } else throw new Error("Unknown action");
    } else if (b.kind === "perm") {
      const t = await prisma.tenant.findUnique({ where: { id: b.tenantId }, select: { permissions: true } });
      const perms: any = (t && t.permissions) || {};
      if (b.allow !== undefined) perms.ownPaymentMethods = !!b.allow;
      if (b.paymentMethodSource !== undefined) perms.paymentMethodSource = b.paymentMethodSource;
      await prisma.tenant.update({ where: { id: b.tenantId }, data: { permissions: perms } });
    } else if (b.kind === "xynder") {
      await prisma.setting.upsert({ where: { key: "payments" }, create: { key: "payments", value: { url: b.url || "", active: !!b.active } }, update: { value: { url: b.url || "", active: !!b.active } } });
    } else throw new Error("Unknown kind");
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 }); }
}

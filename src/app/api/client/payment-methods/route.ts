import { NextResponse } from "next/server";
import { requireClient } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { walletAddedBy } from "@/lib/paymentMethod";

export async function GET() {
  const s = await requireClient();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  // Tenant self-service: when SuperAdmin has ticked "Can add own methods" for
  // this tenant, its clients see ONLY the tenant's own methods — the global
  // defaults are hidden, even before the tenant has added any of its own.
  // Otherwise, the tenant falls back to the global defaults.
  const tenant = await prisma.tenant.findUnique({ where: { id: s.tenantId! }, select: { permissions: true, features: true } });
  const perms: any = (tenant?.permissions as any) || {};
  const moonpayEnabled = !!(process.env.MOONPAY_PK && process.env.MOONPAY_SK && ((tenant?.features as any) || {}).moonpayPayment);

  // paymentMethodSource controls which methods clients see:
  //   "global"    → always show SA global methods (tenantId = null)
  //   "sa_custom" → show SA-configured per-tenant methods (tenantId = tenant)
  //   "tenant"    → show tenant-admin-managed methods (tenantId = tenant)
  //   null/auto   → backward-compat: own rows if any exist (or self-service), else global
  const source: string | null = perms.paymentMethodSource || null;
  let all: any[];
  if (source === "global") {
    all = await prisma.cryptoWallet.findMany({ where: { active: true, tenantId: null }, orderBy: { createdAt: "asc" } });
  } else if (source === "sa_custom") {
    // Show all SA-managed rows for this tenant. No _addedBy filter because rows
    // added before tagging was deployed have no tag but are still SA-managed.
    all = await prisma.cryptoWallet.findMany({ where: { active: true, tenantId: s.tenantId! }, orderBy: { createdAt: "asc" } });
  } else if (source === "tenant") {
    // Show only tenant-admin-managed rows (_addedBy = "tenant" or legacy untagged)
    const rows = await prisma.cryptoWallet.findMany({ where: { active: true, tenantId: s.tenantId! }, orderBy: { createdAt: "asc" } });
    all = rows.filter((w) => walletAddedBy(w) === "tenant");
  } else {
    // auto backward-compat: own rows take priority over global
    const selfService = !!perms.ownPaymentMethods;
    const own = await prisma.cryptoWallet.findMany({ where: { active: true, tenantId: s.tenantId! }, orderBy: { createdAt: "asc" } });
    all = (selfService || own.length > 0)
      ? own
      : await prisma.cryptoWallet.findMany({ where: { active: true, tenantId: null }, orderBy: { createdAt: "asc" } });
  }
  const crypto = all.filter((w) => w.type === "CRYPTO").map((w) => ({ id: w.id, network: w.network, asset: w.asset, address: w.address }));
  const upi = all.filter((w) => w.type === "UPI").map((w) => ({ id: w.id, label: w.label || "UPI", address: w.address }));
  const links = all.filter((w) => w.type === "LINK" && w.url).map((w) => ({ id: w.id, label: w.label || "Local Payment", url: w.url }));
  const bank = all.filter((w) => w.type === "BANK").map((w) => {
    const d: any = (w.details as any) || {};
    return { id: w.id, accountNumber: d.accountNumber || w.address || "", accountName: d.accountName || "", bankName: d.bankName || w.label || "", ifsc: d.ifsc || "" };
  });

  // legacy single Xynder setting -> surface as a link if no LINK methods configured
  const setting = await prisma.setting.findUnique({ where: { key: "payments" } }).catch(() => null);
  const xy: any = (setting && setting.value) || {};
  if (source !== "sa_custom" && source !== "tenant" && links.length === 0 && xy.url && xy.active !== false) links.push({ id: "legacy", label: "Local Payment", url: xy.url });

  return NextResponse.json({
    ok: true,
    wallets: crypto, // back-compat
    crypto,
    upi,
    bank,
    links,
    moonpay: moonpayEnabled,
    xynder: { url: links[0]?.url || "", active: links.length > 0 }, // back-compat
  });
}

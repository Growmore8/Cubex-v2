import { NextResponse } from "next/server";
import { requireClient } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const s = await requireClient();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  // Tenant self-service: when SuperAdmin has ticked "Can add own methods" for
  // this tenant, its clients see ONLY the tenant's own methods — the global
  // defaults are hidden, even before the tenant has added any of its own.
  // Otherwise, the tenant falls back to the global defaults.
  const tenant = await prisma.tenant.findUnique({ where: { id: s.tenantId! }, select: { permissions: true, features: true } });
  const selfService = !!((tenant?.permissions as any) || {}).ownPaymentMethods;
  const own = await prisma.cryptoWallet.findMany({
    where: { active: true, tenantId: s.tenantId! },
    orderBy: { createdAt: "asc" },
  });
  const all = selfService || own.length > 0
    ? own
    : await prisma.cryptoWallet.findMany({
        where: { active: true, tenantId: null },
        orderBy: { createdAt: "asc" },
      });
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
  if (!selfService && links.length === 0 && xy.url && xy.active !== false) links.push({ id: "legacy", label: "Local Payment", url: xy.url });

  return NextResponse.json({
    ok: true,
    wallets: crypto, // back-compat
    crypto,
    upi,
    bank,
    links,
    xynder: { url: links[0]?.url || "", active: links.length > 0 }, // back-compat
  });
}

import { NextResponse } from "next/server";
import { requireClient } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const s = await requireClient();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  // global defaults (tenantId null) + this tenant's own methods
  const all = await prisma.cryptoWallet.findMany({
    where: { active: true, OR: [{ tenantId: null }, { tenantId: s.tenantId! }] },
    orderBy: { createdAt: "asc" },
  });
  const crypto = all.filter((w) => w.type === "CRYPTO").map((w) => ({ id: w.id, network: w.network, asset: w.asset, address: w.address }));
  const upi = all.filter((w) => w.type === "UPI").map((w) => ({ id: w.id, label: w.label || "UPI", address: w.address }));
  const links = all.filter((w) => w.type === "LINK" && w.url).map((w) => ({ id: w.id, label: w.label || "Local Payment", url: w.url }));

  // legacy single Xynder setting -> surface as a link if no LINK methods configured
  const setting = await prisma.setting.findUnique({ where: { key: "payments" } }).catch(() => null);
  const xy: any = (setting && setting.value) || {};
  if (links.length === 0 && xy.url && xy.active !== false) links.push({ id: "legacy", label: "Local Payment", url: xy.url });

  return NextResponse.json({
    ok: true,
    wallets: crypto, // back-compat
    crypto,
    upi,
    links,
    xynder: { url: links[0]?.url || "", active: links.length > 0 }, // back-compat
  });
}

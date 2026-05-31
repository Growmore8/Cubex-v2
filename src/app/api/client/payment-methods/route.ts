import { NextResponse } from "next/server";
import { requireClient } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const s = await requireClient();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const wallets = await prisma.cryptoWallet.findMany({ where: { active: true }, orderBy: { createdAt: "asc" } });
  const setting = await prisma.setting.findUnique({ where: { key: "payments" } }).catch(() => null);
  const xy: any = (setting && setting.value) || {};
  return NextResponse.json({ ok: true, wallets: wallets.map((w) => ({ id: w.id, network: w.network, asset: w.asset, address: w.address })), xynder: { url: xy.url || "", active: xy.active !== false && !!xy.url } });
}
import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const wallets = await prisma.cryptoWallet.findMany({ orderBy: { createdAt: "asc" } });
  const setting = await prisma.setting.findUnique({ where: { key: "payments" } }).catch(() => null);
  return NextResponse.json({ ok: true, wallets, xynder: (setting && setting.value) || {} });
}

export async function POST(req: Request) {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const b = await req.json();
    if (b.kind === "wallet") {
      if (b.action === "add") { if (!b.address) throw new Error("Address required"); await prisma.cryptoWallet.create({ data: { network: b.network || "BEP20", asset: b.asset || "USDT", address: b.address, active: true } }); }
      else if (b.action === "update") await prisma.cryptoWallet.update({ where: { id: b.id }, data: { network: b.network, asset: b.asset || "USDT", address: b.address, active: b.active !== false } });
      else if (b.action === "delete") await prisma.cryptoWallet.delete({ where: { id: b.id } });
      else throw new Error("Unknown action");
    } else if (b.kind === "xynder") {
      await prisma.setting.upsert({ where: { key: "payments" }, create: { key: "payments", value: { url: b.url || "", active: !!b.active } }, update: { value: { url: b.url || "", active: !!b.active } } });
    } else throw new Error("Unknown kind");
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 }); }
}
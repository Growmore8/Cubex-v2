import { NextResponse } from "next/server";
import { requireClient } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const s = await requireClient();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const methods = await prisma.withdrawalMethod.findMany({ where: { userId: s.sub }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] });
  return NextResponse.json({ ok: true, methods });
}

export async function POST(req: Request) {
  const s = await requireClient();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const b = await req.json();
    if (b.action === "delete") {
      const m = await prisma.withdrawalMethod.findUnique({ where: { id: b.id } });
      if (!m || m.userId !== s.sub) throw new Error("Not found");
      await prisma.withdrawalMethod.delete({ where: { id: b.id } });
      return NextResponse.json({ ok: true });
    }
    if (b.action === "default") {
      const m = await prisma.withdrawalMethod.findUnique({ where: { id: b.id } });
      if (!m || m.userId !== s.sub) throw new Error("Not found");
      await prisma.withdrawalMethod.updateMany({ where: { userId: s.sub }, data: { isDefault: false } });
      await prisma.withdrawalMethod.update({ where: { id: b.id }, data: { isDefault: true } });
      return NextResponse.json({ ok: true });
    }
    // add
    const type = (b.type || "CRYPTO").toUpperCase();
    if (!b.address) throw new Error(type === "UPI" ? "UPI id required" : type === "BANK" ? "Account number required" : "Wallet address required");
    if (!b.label) throw new Error("Give this method a name");
    const count = await prisma.withdrawalMethod.count({ where: { userId: s.sub } });
    await prisma.withdrawalMethod.create({
      data: {
        userId: s.sub,
        tenantId: s.tenantId!,
        type,
        network: type === "CRYPTO" ? (b.network || "BEP20") : null,
        asset: type === "CRYPTO" ? (b.asset || "USDT") : null,
        address: b.address,
        label: b.label,
        details: b.details || undefined,
        isDefault: count === 0, // first saved method is default
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}

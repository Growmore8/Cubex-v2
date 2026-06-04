import { NextResponse } from "next/server";
import { requireClient } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/services/account.service";

export async function GET() {
  const s = await requireClient();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const accounts = await prisma.account.findMany({
    where: { tenantId: s.tenantId!, userId: s.sub },
    orderBy: { createdAt: "asc" },
    select: { id: true, login: true, type: true, currency: true, leverage: true, deposit: true, withdrawal: true, credit: true, bonus: true, pnl: true, locked: true, deactivated: true },
  });
  return NextResponse.json({ ok: true, accounts: accounts.map((a) => ({ ...a, deposit: Number(a.deposit), withdrawal: Number(a.withdrawal), credit: Number(a.credit), bonus: Number(a.bonus), pnl: Number(a.pnl) })) });
}

export async function POST(req: Request) {
  const s = await requireClient();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const b = await req.json();
    const type = b.type === "DEMO" ? "DEMO" : "LIVE";
    const user = await prisma.user.findUnique({ where: { id: s.sub } });
    if (!user) throw new Error("User not found");
    // If the client has been locked/deactivated by staff, block new account creation
    const restricted = await prisma.account.findFirst({ where: { userId: s.sub, OR: [{ locked: true }, { deactivated: true }] }, select: { id: true } });
    if (restricted) throw new Error("Your account is restricted. Please contact support.");
    if (type === "LIVE") {
      const liveCount = await prisma.account.count({ where: { userId: s.sub, type: "LIVE" } });
      if (liveCount === 0) {
        const approved = await prisma.kycDocument.findFirst({ where: { account: { userId: s.sub }, status: "APPROVED" } });
        if (!approved) throw new Error("KYC approval is required before opening your first live account");
      }
    }
    const acc = await createClient(s.tenantId!, { email: user.email, name: user.name, type, leverage: Number(b.leverage) || 100, currency: b.currency || "USD" }, "client-self");
    return NextResponse.json({ ok: true, account: { id: acc.id, login: acc.login, type: acc.type } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}
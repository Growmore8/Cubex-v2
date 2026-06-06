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
    // Block only if the user account itself is suspended/locked by staff
    if (user.status !== "ACTIVE") throw new Error("Your account is restricted. Please contact support.");
    if (type === "DEMO") {
      // a client may hold only one demo account
      const demoCount = await prisma.account.count({ where: { userId: s.sub, type: "DEMO" } });
      if (demoCount >= 1) throw new Error("You can only have one demo account");
    }
    // Note: a client opens their first live account WITHOUT prior KYC. The live
    // account is then locked to Profile + KYC (per-client gate) until verified —
    // so we must NOT block creation on KYC here, or it's a chicken-and-egg lock.
    const acc = await createClient(s.tenantId!, { email: user.email, name: user.name, type, leverage: Number(b.leverage) || 100, currency: b.currency || "USD" }, "client-self");
    return NextResponse.json({ ok: true, account: { id: acc.id, login: acc.login, type: acc.type } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}
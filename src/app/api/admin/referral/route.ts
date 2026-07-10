import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

// GET — return referral config + all referrals for this tenant
export async function GET() {
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false }, { status: 403 });
  try {
    const cfg = await prisma.setting.findUnique({ where: { key: `referral:${s.tenantId}` } });
    const config = (cfg?.value as any) || { signupBonus: 0, depositPercent: 0, tradingPercent: 0, minDepositForSignup: 0 };

    const referrals = await (prisma.referral as any).findMany({
      where: { tenantId: s.tenantId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    // Enrich with referrer + referee names/emails
    const referrerIds = [...new Set(referrals.map((r: any) => r.referrerId))] as string[];
    const refereeIds  = [...new Set(referrals.map((r: any) => r.refereeId))]  as string[];
    const allIds      = [...new Set([...referrerIds, ...refereeIds])];
    const users = await prisma.user.findMany({ where: { id: { in: allIds } }, select: { id: true, name: true, email: true } });
    const userMap = Object.fromEntries(users.map((u) => [u.id, u]));

    return NextResponse.json({
      ok: true,
      config,
      referrals: referrals.map((r: any) => ({
        ...r,
        totalEarned:   Number(r.totalEarned),
        referrerName:  userMap[r.referrerId]?.name  || "—",
        referrerEmail: userMap[r.referrerId]?.email || "—",
        refereeName:   userMap[r.refereeId]?.name   || "—",
        refereeEmail:  userMap[r.refereeId]?.email  || "—",
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

// PUT — save referral config
export async function PUT(req: Request) {
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false }, { status: 403 });
  try {
    const body = await req.json();
    const config = {
      signupBonus:         Number(body.signupBonus || 0),
      depositPercent:      Number(body.depositPercent || 0),
      tradingPercent:      Number(body.tradingPercent || 0),
      minDepositForSignup: Number(body.minDepositForSignup || 0),
    };
    await prisma.setting.upsert({
      where: { key: `referral:${s.tenantId}` },
      update: { value: config as any },
      create: { key: `referral:${s.tenantId}`, value: config as any },
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function makeCode() {
  let c = "";
  for (let i = 0; i < 8; i++) c += CHARS[Math.floor(Math.random() * CHARS.length)];
  return c;
}

export async function GET() {
  const s = await getSession();
  if (!s || s.role !== "CLIENT") return NextResponse.json({ ok: false }, { status: 401 });
  try {
    let user = await (prisma.user.findUnique as any)({ where: { id: s.sub }, select: { id: true, referralCode: true } });
    if (!user) return NextResponse.json({ ok: false }, { status: 404 });

    if (!user.referralCode) {
      let code = "";
      for (let i = 0; i < 10 && !code; i++) {
        const c = makeCode();
        const clash = await (prisma.user.findUnique as any)({ where: { referralCode: c } });
        if (!clash) code = c;
      }
      await (prisma.user.update as any)({ where: { id: s.sub }, data: { referralCode: code } });
      user = { id: s.sub, referralCode: code };
    }

    const referrals = await (prisma.referral as any).findMany({
      where: { referrerId: s.sub },
      orderBy: { createdAt: "desc" },
    });

    const totalEarned = referrals.reduce((sum: number, r: any) => sum + Number(r.totalEarned), 0);

    // Get tenant config for reward rates
    const cfg = await prisma.setting.findUnique({ where: { key: `referral:${s.tenantId}` } });
    const config: any = (cfg?.value as any) || {};

    return NextResponse.json({
      ok: true,
      referralCode: user.referralCode,
      count: referrals.length,
      totalEarned,
      signupBonus: Number(config.signupBonus || 0),
      depositPercent: Number(config.depositPercent || 0),
      tradingPercent: Number(config.tradingPercent || 0),
      referrals: referrals.slice(0, 10).map((r: any) => ({
        id: r.id,
        signupBonusPaid: r.signupBonusPaid,
        totalEarned: Number(r.totalEarned),
        createdAt: r.createdAt,
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

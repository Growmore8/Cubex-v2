import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const relations = await prisma.copyRelation.findMany({
      where: { tenantId: s.tenantId! },
      include: {
        masterAcc: { select: { id: true, login: true, name: true, type: true } },
        followerAcc: { select: { id: true, login: true, name: true, type: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({
      ok: true,
      relations: relations.map((r: any) => ({
        id: r.id, ratio: Number(r.ratio), active: r.active, createdAt: r.createdAt,
        master: r.masterAcc, follower: r.followerAcc,
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const { masterAccId, followerAccId, ratio } = await req.json();
    if (!masterAccId || !followerAccId) return NextResponse.json({ ok: false, error: "masterAccId and followerAccId required" }, { status: 400 });
    if (masterAccId === followerAccId) return NextResponse.json({ ok: false, error: "Master and follower must be different accounts" }, { status: 400 });

    // Verify both accounts belong to this tenant
    const [master, follower] = await Promise.all([
      prisma.account.findFirst({ where: { id: masterAccId, tenantId: s.tenantId! }, select: { id: true } }),
      prisma.account.findFirst({ where: { id: followerAccId, tenantId: s.tenantId! }, select: { id: true } }),
    ]);
    if (!master) return NextResponse.json({ ok: false, error: "Master account not found" }, { status: 404 });
    if (!follower) return NextResponse.json({ ok: false, error: "Follower account not found" }, { status: 404 });

    const rel = await prisma.copyRelation.create({
      data: {
        tenantId: s.tenantId!,
        masterAccId,
        followerAccId,
        ratio: Number(ratio) > 0 ? Number(ratio) : 1.0,
      },
      include: {
        masterAcc: { select: { id: true, login: true, name: true, type: true } },
        followerAcc: { select: { id: true, login: true, name: true, type: true } },
      },
    });
    return NextResponse.json({
      ok: true,
      relation: { id: rel.id, ratio: Number(rel.ratio), active: rel.active, createdAt: rel.createdAt, master: rel.masterAcc, follower: rel.followerAcc },
    });
  } catch (e: any) {
    if (e?.code === "P2002") return NextResponse.json({ ok: false, error: "This copy relationship already exists" }, { status: 409 });
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

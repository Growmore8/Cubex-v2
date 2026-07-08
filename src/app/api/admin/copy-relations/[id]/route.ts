import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const { id } = await params;
    const body = await req.json();
    const rel = await prisma.copyRelation.findFirst({ where: { id, tenantId: s.tenantId! } });
    if (!rel) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    const data: any = {};
    if (body.active !== undefined) data.active = Boolean(body.active);
    if (body.ratio !== undefined && Number(body.ratio) > 0) data.ratio = Number(body.ratio);
    await prisma.copyRelation.update({ where: { id }, data });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const { id } = await params;
    const rel = await prisma.copyRelation.findFirst({ where: { id, tenantId: s.tenantId! } });
    if (!rel) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    await prisma.copyRelation.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

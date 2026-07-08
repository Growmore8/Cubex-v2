import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const signal = await prisma.signal.findUnique({ where: { id } });
  if (!signal || signal.tenantId !== s.tenantId) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  const updated = await prisma.signal.update({ where: { id }, data: { active: body.active ?? signal.active } });
  return NextResponse.json({ ok: true, signal: updated });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const signal = await prisma.signal.findUnique({ where: { id } });
  if (!signal || signal.tenantId !== s.tenantId) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  await prisma.signal.delete({ where: { id } });
  await audit(s.tenantId!, "signal_delete", `${signal.direction} ${signal.symbol}`, s.email);
  return NextResponse.json({ ok: true });
}

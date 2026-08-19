import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const u = new URL(req.url);
  const q = u.searchParams.get("q") || ""; const category = u.searchParams.get("category") || "";
  const tenantId = u.searchParams.get("tenantId") || ""; const from = u.searchParams.get("from") || ""; const to = u.searchParams.get("to") || "";
  const where: any = {};
  if (category) where.category = category;
  if (tenantId) where.tenantId = tenantId;
  if (q) where.OR = [{ action: { contains: q, mode: "insensitive" } }, { detail: { contains: q, mode: "insensitive" } }, { performedBy: { contains: q, mode: "insensitive" } }];
  if (from || to) { where.createdAt = {}; if (from) where.createdAt.gte = new Date(from); if (to) { const d = new Date(to); d.setHours(23, 59, 59, 999); where.createdAt.lte = d; } }
  const rows = await prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take: 300, include: { tenant: { select: { name: true, brandName: true } } } });
  const items = rows.map((r: any) => ({ id: r.id.toString(), action: r.action, detail: r.detail, category: r.category, by: r.performedBy, company: r.tenant ? (r.tenant.brandName || r.tenant.name) : null, at: r.createdAt }));
  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true, brandName: true }, orderBy: { name: "asc" } });
  return NextResponse.json({ ok: true, items, companies: tenants.map((t) => ({ id: t.id, name: t.brandName || t.name })) });
}

export async function DELETE(req: Request) {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const b = await req.json();
    if (b.deleteAll) {
      // Delete all logs matching the current filters
      const where: any = {};
      if (b.category)  where.category = b.category;
      if (b.tenantId)  where.tenantId = b.tenantId;
      if (b.q) where.OR = [{ action: { contains: b.q, mode: "insensitive" } }, { detail: { contains: b.q, mode: "insensitive" } }, { performedBy: { contains: b.q, mode: "insensitive" } }];
      if (b.from || b.to) { where.createdAt = {}; if (b.from) where.createdAt.gte = new Date(b.from); if (b.to) { const d = new Date(b.to); d.setHours(23, 59, 59, 999); where.createdAt.lte = d; } }
      const { count } = await prisma.auditLog.deleteMany({ where });
      return NextResponse.json({ ok: true, deleted: count });
    }
    if (Array.isArray(b.ids) && b.ids.length) {
      const bigIds = b.ids.map((id: string) => BigInt(id));
      const { count } = await prisma.auditLog.deleteMany({ where: { id: { in: bigIds } } });
      return NextResponse.json({ ok: true, deleted: count });
    }
    if (b.id) {
      await prisma.auditLog.delete({ where: { id: BigInt(b.id) } });
      return NextResponse.json({ ok: true, deleted: 1 });
    }
    throw new Error("No id(s) provided");
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}
import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";

export async function GET() {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const recent = await prisma.notification.findMany({ orderBy: { createdAt: "desc" }, distinct: ["title"], take: 15, select: { title: true, body: true, createdAt: true } });
  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true, brandName: true }, orderBy: { name: "asc" } });
  return NextResponse.json({ ok: true, recent, companies: tenants.map((t) => ({ id: t.id, name: t.brandName || t.name })) });
}

export async function POST(req: Request) {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const b = await req.json();
    const title = (b.title || "").trim(); if (!title) throw new Error("Title required");
    const where: any = {};
    if (b.tenantId) where.tenantId = b.tenantId;
    if (b.role === "CLIENT" || b.role === "MANAGER") where.role = b.role; else where.role = { in: ["CLIENT", "MANAGER"] };
    const users = await prisma.user.findMany({ where, select: { id: true, tenantId: true } });
    const data = users.filter((u) => u.tenantId).map((u) => ({ tenantId: u.tenantId as string, userId: u.id, title, body: b.body || null, image: b.image || null }));
    if (data.length === 0) throw new Error("No recipients match");
    await prisma.notification.createMany({ data });
    try { await audit((s.tenantId as any), "sa.notify", title + " (" + data.length + ")", s.email); } catch (e) {}
    return NextResponse.json({ ok: true, count: data.length });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 }); }
}
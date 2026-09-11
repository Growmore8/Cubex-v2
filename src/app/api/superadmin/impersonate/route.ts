import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { Redis } from "ioredis";
import { randomUUID } from "crypto";

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

export async function POST(req: NextRequest) {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  const { tenantId } = await req.json();
  if (!tenantId) return NextResponse.json({ ok: false, error: "tenantId required" }, { status: 400 });

  // Find the tenant and its primary admin user
  const [tenant, user] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { subdomain: true, customDomain: true } }),
    prisma.user.findFirst({
      where: { tenantId, role: "ADMIN" },
      select: { id: true, email: true, name: true, role: true, tenantId: true },
    }),
  ]);

  if (!tenant) return NextResponse.json({ ok: false, error: "Tenant not found" }, { status: 404 });
  if (!user) return NextResponse.json({ ok: false, error: "No admin user found for this tenant" }, { status: 404 });

  // One-time token — 60 second TTL, single use
  const token = randomUUID();
  await redis.set(
    `imp:${token}`,
    JSON.stringify({ userId: user.id, email: user.email, name: user.name, role: user.role, tenantId: user.tenantId }),
    "EX",
    60
  );

  return NextResponse.json({ ok: true, token, subdomain: tenant.subdomain, customDomain: tenant.customDomain || null });
}

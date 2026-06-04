import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";

export async function GET(req: Request) {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  const sp = new URL(req.url).searchParams;
  const scope = sp.get("scope") || "";
  const tenantId = sp.get("tenantId") || "";
  const role = sp.get("role") || "";
  const q = sp.get("q") || "";

  // Recipient preview / search lookup
  if (scope) {
    const where: any = {};
    // Scope rules:
    // global  → all users (not SUPERADMIN), no tenant filter
    // tenant  → all users in tenantId (all roles except SUPERADMIN)
    // clients → role CLIENT, optional tenantId filter
    // specific (search) → role CLIENT only, optional tenantId
    if (scope === "global") {
      where.role = { not: "SUPERADMIN" as any };
    } else if (scope === "tenant") {
      if (tenantId) where.tenantId = tenantId;
      where.role = { not: "SUPERADMIN" as any };
    } else {
      // clients or specific search — always CLIENT only
      where.role = "CLIENT" as any;
      if (tenantId) where.tenantId = tenantId;
    }
    if (q) where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { accounts: { some: { login: { contains: q, mode: "insensitive" } } } },
    ];
    const [users, count] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true, name: true, email: true, role: true, tenantId: true,
          accounts: { select: { login: true, type: true }, take: 1, orderBy: { createdAt: "asc" } },
        },
        take: 50,
        orderBy: { name: "asc" },
      }),
      prisma.user.count({ where }),
    ]);
    const mapped = users.map((u) => ({
      id: u.id, name: u.name, email: u.email, role: u.role, tenantId: u.tenantId,
      login: u.accounts[0]?.login ?? null,
      accountType: u.accounts[0]?.type ?? null,
    }));
    return NextResponse.json({ ok: true, users: mapped, count });
  }

  // Main load: history + tenants
  const [history, tenants] = await Promise.all([
    prisma.notification.findMany({
      orderBy: { createdAt: "desc" },
      distinct: ["batchId"],
      where: { batchId: { not: null } },
      select: { batchId: true, title: true, body: true, targetScope: true, senderRole: true, createdAt: true },
      take: 30,
    }),
    prisma.tenant.findMany({ select: { id: true, name: true, brandName: true }, orderBy: { name: "asc" } }),
  ]);

  return NextResponse.json({
    ok: true,
    history,
    tenants: tenants.map((t) => ({ id: t.id, name: t.brandName || t.name })),
  });
}

export async function POST(req: Request) {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const b = await req.json();
    const title = (b.title || "").trim();
    if (!title) throw new Error("Title required");

    const where: any = {};
    const scope = b.scope || "global";

    if (scope === "global") {
      // All users, no tenant filter
      where.role = { not: "SUPERADMIN" as any };
    } else if (scope === "tenant") {
      // All users in a specific tenant
      if (!b.tenantId) throw new Error("tenantId required for Tenant targeting");
      where.tenantId = b.tenantId;
      where.role = { not: "SUPERADMIN" as any };
    } else if (scope === "clients") {
      // All clients, optional tenant filter
      where.role = "CLIENT" as any;
      if (b.tenantId) where.tenantId = b.tenantId;
    } else if (scope === "specific") {
      // Single user (must be a client)
      if (!b.userId) throw new Error("userId required for Specific targeting");
      where.id = b.userId;
      where.role = "CLIENT" as any;
    } else {
      throw new Error("Invalid scope");
    }

    const users = await prisma.user.findMany({ where, select: { id: true, tenantId: true } });
    const recipients = users.filter((u) => u.tenantId);
    if (recipients.length === 0) throw new Error("No recipients match the selected criteria");

    const batchId = `sa-${Date.now()}`;
    const targetScope = scope + (b.tenantId ? ":tenant" : "") + (b.userId ? ":user" : "");

    await prisma.notification.createMany({
      data: recipients.map((u) => ({
        tenantId: u.tenantId as string,
        userId: u.id,
        title,
        body: b.body || null,
        image: b.image || null,
        batchId,
        targetScope,
        senderId: s.sub,
        senderRole: "SUPERADMIN",
        type: b.type || "NOTICE",
      })),
    });

    await audit(null, "sa.notify", `${title} → ${scope} (${recipients.length})`, s.email);
    return NextResponse.json({ ok: true, count: recipients.length, batchId });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}

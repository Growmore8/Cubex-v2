import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { generateApiKey } from "@/lib/apiKey";
import { audit } from "@/lib/audit";

// SuperAdmin management of server-to-server API keys (one tenant per key).
export async function GET() {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const [keys, tenants] = await Promise.all([
    prisma.apiKey.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.tenant.findMany({ select: { id: true, name: true, brandName: true }, orderBy: { name: "asc" } }),
  ]);
  const tName: Record<string, string> = Object.fromEntries(tenants.map((t) => [t.id, t.brandName || t.name]));
  return NextResponse.json({
    ok: true,
    keys: keys.map((k) => ({ id: k.id, label: k.label, prefix: k.prefix, active: k.active, lastUsedAt: k.lastUsedAt, createdAt: k.createdAt, tenantId: k.tenantId, tenantName: tName[k.tenantId] || "—" })),
    tenants: tenants.map((t) => ({ id: t.id, name: t.brandName || t.name })),
  });
}

export async function POST(req: Request) {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const b = await req.json();
    if (b.action === "create") {
      const tenant = await prisma.tenant.findUnique({ where: { id: b.tenantId }, select: { id: true, name: true } });
      if (!tenant) throw new Error("Tenant not found");
      const label = String(b.label || "").trim();
      if (!label) throw new Error("Label is required");
      const { raw, keyHash, prefix } = generateApiKey();
      await prisma.apiKey.create({ data: { tenantId: tenant.id, label, keyHash, prefix } });
      await audit(tenant.id, "sa.apiKey.create", label, s.email).catch(() => {});
      // raw key returned ONCE — never stored, never shown again
      return NextResponse.json({ ok: true, key: raw });
    } else if (b.action === "revoke") {
      const k = await prisma.apiKey.findUnique({ where: { id: b.id } });
      if (!k) throw new Error("Key not found");
      await prisma.apiKey.update({ where: { id: k.id }, data: { active: false } });
      await audit(k.tenantId, "sa.apiKey.revoke", k.label, s.email).catch(() => {});
    } else if (b.action === "delete") {
      const k = await prisma.apiKey.findUnique({ where: { id: b.id } });
      if (!k) throw new Error("Key not found");
      await prisma.apiKey.delete({ where: { id: k.id } });
      await audit(k.tenantId, "sa.apiKey.delete", k.label, s.email).catch(() => {});
    } else throw new Error("Unknown action");
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 }); }
}

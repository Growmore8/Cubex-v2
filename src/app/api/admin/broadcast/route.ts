import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { notifyTenantClients } from "@/services/notification.service";
import { audit } from "@/lib/audit";

const schema = z.object({ title: z.string().min(1), body: z.string().optional() });

export async function POST(req: Request) {
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const { title, body } = schema.parse(await req.json());
    const tenant = await prisma.tenant.findUnique({ where: { id: s.tenantId! }, select: { name: true, brandName: true } });
    const brand = (tenant?.brandName || tenant?.name || "").trim();
    const signed = ((body || "").trim() ? body!.trim() + "\n\n" : "") + `— ${brand ? brand + " " : ""}Support Team`;
    await notifyTenantClients(s.tenantId!, title, signed);
    await audit(s.tenantId!, "broadcast", title, s.email);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}

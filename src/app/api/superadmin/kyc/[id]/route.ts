import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const b = await req.json();
    const status = b.action === "approve" ? "APPROVED" : b.action === "reject" ? "REJECTED" : null;
    if (!status) throw new Error("Unknown action");
    const doc: any = await prisma.kycDocument.update({ where: { id: id }, data: { status: status as any }, include: { account: true } });
    await audit(doc.account.tenantId, "sa.kyc." + b.action, doc.account.login, s.email);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}
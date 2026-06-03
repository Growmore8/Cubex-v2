import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const b = await req.json();
    const rec = await prisma.kycDocument.findUnique({ where: { id: id }, include: { account: true } });
    if (!rec) throw new Error("KYC document not found");
    if (rec.account.tenantId !== s.tenantId) throw new Error("Forbidden");
    const status = b.action === "approve" ? "APPROVED" : "REJECTED";
    await prisma.kycDocument.update({ where: { id: rec.id }, data: { status: status as any, note: b.note || rec.note } });
    await audit(s.tenantId as string, "kyc." + status.toLowerCase(), rec.docType + " " + rec.id, s.email || "admin");
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}
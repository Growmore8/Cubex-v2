import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { notify } from "@/services/notification.service";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const b = await req.json();
    const rec = await prisma.kycDocument.findUnique({ where: { id: id }, include: { account: true } });
    if (!rec) throw new Error("KYC document not found");
    if (rec.account.tenantId !== s.tenantId) throw new Error("Forbidden");
    // Cannot verify a document without its back side
    if (b.action === "approve" && !rec.backUrl) throw new Error("Cannot verify — back side of the document is missing");
    if (b.action === "reject" && !String(b.note || "").trim()) throw new Error("A rejection reason is required");
    const status = b.action === "approve" ? "APPROVED" : "REJECTED";
    await prisma.kycDocument.update({ where: { id: rec.id }, data: { status: status as any, note: b.note || rec.note } });
    await prisma.account.update({ where: { id: rec.accountId }, data: { kycStatus: status as any } }).catch(() => {});
    await audit(s.tenantId as string, "kyc." + status.toLowerCase(), rec.account.login + " " + rec.docType, s.email || "admin");
    // Notify the client of the KYC decision
    if (rec.account.userId) {
      const msg = status === "APPROVED" ? "Your KYC has been approved ✓" : "Your KYC was rejected" + (b.note ? ": " + b.note : "");
      await notify(rec.account.tenantId, rec.account.userId, "KYC " + (status === "APPROVED" ? "Approved" : "Rejected"), msg, "NOTICE").catch(() => {});
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}
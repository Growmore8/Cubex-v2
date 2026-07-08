import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { notify } from "@/services/notification.service";
import { sendUserMail } from "@/lib/tenant-mail";
import { kycStatusEmail } from "@/lib/email-templates";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const b = await req.json();
    // reverse: send an approved/rejected doc back to PENDING so the client must re-submit
    const status = b.action === "approve" ? "APPROVED" : b.action === "reject" ? "REJECTED" : b.action === "reverse" ? "PENDING" : null;
    if (!status) throw new Error("Unknown action");
    if (b.action === "approve") { const cur = await prisma.kycDocument.findUnique({ where: { id } }); if (cur && !cur.backUrl) throw new Error("Cannot verify — back side missing"); }
    if (b.action === "reject" && !String(b.note || "").trim()) throw new Error("A rejection reason is required");
    const doc: any = await prisma.kycDocument.update({ where: { id: id }, data: { status: status as any, ...(b.note ? { note: b.note } : {}) }, include: { account: true } });
    await prisma.account.update({ where: { id: doc.accountId }, data: { kycStatus: status as any } }).catch(() => {});
    await audit(doc.account.tenantId, "sa.kyc." + b.action, doc.account.login, s.email);
    // Notify the client of the decision
    if (doc.account.userId) {
      const map: Record<string, [string, string]> = {
        approve: ["KYC Approved", "Your KYC has been verified ✓"],
        reject: ["KYC Rejected", "Your KYC was rejected" + (b.note ? ": " + b.note : "") + ". Please upload again."],
        reverse: ["KYC Re-review", "Your KYC needs to be re-submitted. Please upload your documents again."],
      };
      const m = map[b.action]; if (m) await notify(doc.account.tenantId, doc.account.userId, m[0], m[1], "NOTICE").catch(() => {});
      // Email on approve / reject (not reverse — reverse just prompts re-upload via in-app)
      if (b.action === "approve" || b.action === "reject") {
        sendUserMail(doc.account.tenantId, doc.account.userId,
          b.action === "approve" ? "KYC Verified – Identity Confirmed" : "KYC Update – Action Required",
          (brand) => kycStatusEmail(brand, {
            holderName: (doc.account as any).name || "Valued Client",
            status: b.action === "approve" ? "APPROVED" : "REJECTED",
            note: b.note || null,
          })
        ).catch(() => {});
      }
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}
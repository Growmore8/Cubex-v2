import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { createKyc } from "@/services/kyc.service";
import { saveUpload } from "@/lib/upload";
import { audit } from "@/lib/audit";
import { notify } from "@/services/notification.service";

export async function POST(req: Request) {
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const form = await req.formData();
    const accountId = String(form.get("accountId") || "");
    const login = String(form.get("login") || "");
    const docType = String(form.get("docType") || "document");
    const file = form.get("file") as File | null;
    const back = form.get("back") as File | null;
    if (!file || file.size === 0) throw new Error("Front side is required");
    if (!back || back.size === 0) throw new Error("Back side is required — both front and back must be uploaded");
    const account = accountId
      ? await prisma.account.findFirst({ where: { id: accountId, tenantId: s.tenantId! } })
      : login
      ? await prisma.account.findFirst({ where: { login, tenantId: s.tenantId! } })
      : null;
    if (!account) throw new Error("Client account not found");
    if ((account as any).kycStatus === "APPROVED") throw new Error("This client is already KYC verified. No further documents are required.");
    const key = await saveUpload(file, "kyc/" + account.id);
    const backKey = await saveUpload(back, "kyc/" + account.id);
    // Staff (admin/manager) upload is trusted -> auto-approve, no separate verify step.
    const doc = await createKyc(account.id, docType, key, backKey, "APPROVED");
    await audit(s.tenantId!, "kyc.upload", account.login + " " + docType + " (auto-approved)", s.email);
    if (account.userId) await notify(s.tenantId!, account.userId, "KYC Approved", "Your KYC has been verified ✓", "NOTICE").catch(() => {});
    return NextResponse.json({ ok: true, doc });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Upload failed" }, { status: 400 });
  }
}
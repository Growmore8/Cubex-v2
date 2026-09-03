import { NextResponse } from "next/server";
import { requireClient } from "@/lib/guard";
import { listClientKyc, createKyc } from "@/services/kyc.service";
import { notifyStaff } from "@/services/notification.service";
import { sendTenantSms } from "@/lib/sms";
import { saveUpload } from "@/lib/upload";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

async function resolveAccount(tenantId: string, userId: string, accountId?: string | null) {
  if (accountId) {
    // Use the specific account the client submitted from — verify it belongs to them.
    return prisma.account.findFirst({ where: { id: accountId, tenantId, userId } });
  }
  // Fallback: find any LIVE account for this user (prefer LIVE over DEMO).
  return prisma.account.findFirst({ where: { tenantId, userId, type: "LIVE" } })
    ?? prisma.account.findFirst({ where: { tenantId, userId } });
}

export async function GET(req: Request) {
  const s = await requireClient();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const accountId = url.searchParams.get("accountId");
  const account = await resolveAccount(s.tenantId!, s.sub, accountId);
  if (!account) return NextResponse.json({ ok: false, error: "No account" }, { status: 404 });
  const docs = await listClientKyc(account.id);
  return NextResponse.json({ ok: true, docs });
}

export async function POST(req: Request) {
  const s = await requireClient();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const form = await req.formData();
    const submittedAccountId = form.get("accountId") as string | null;
    const account = await resolveAccount(s.tenantId!, s.sub, submittedAccountId);
    if (!account) throw new Error("No account");
    if ((account as any).type === "DEMO") throw new Error("KYC verification is only required for live accounts.");
    if ((account as any).kycStatus === "APPROVED") throw new Error("Your identity is already verified. No further documents are required.");
    const docType = String(form.get("docType") || "document");
    const file = form.get("file") as File | null;
    const back = form.get("back") as File | null;
    if (!file || file.size === 0) throw new Error("Identity Document (front) is required");
    if (!back || back.size === 0) throw new Error("Address Proof (back) is required — both documents must be uploaded");
    const key = await saveUpload(file, "kyc/" + account.id);
    const backKey = await saveUpload(back, "kyc/" + account.id);
    const doc = await createKyc(account.id, docType, key, backKey);
    await notifyStaff(s.tenantId!, { title: "New KYC submitted", body: account.login + " uploaded " + docType + " (front + back)", type: "NOTICE" }, (account as any).managerId);
    const docLabel = docType === "IDENTITY" ? "Identity Document" : docType === "ADDRESS" ? "Address Document" : docType;
    sendTenantSms(s.tenantId!, `KYC Document Submitted\nClient: ${account.name} (${account.login})\nDocument: ${docLabel}\nPlease review in the admin panel.`).catch(() => {});
    await audit(s.tenantId!, "kyc.submit", account.login + " uploaded " + docType + " (front + back)", s.email || account.login, "CLIENT");
    return NextResponse.json({ ok: true, doc });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Upload failed" }, { status: 400 });
  }
}

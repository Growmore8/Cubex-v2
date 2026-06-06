import { NextResponse } from "next/server";
import { requireClient } from "@/lib/guard";
import { clientAccount, listClientKyc, createKyc } from "@/services/kyc.service";
import { notifyTenantAdmins } from "@/services/notification.service";
import { saveUpload } from "@/lib/upload";
import { audit } from "@/lib/audit";

export async function GET() {
  const s = await requireClient();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const account = await clientAccount(s.tenantId!, s.sub);
  if (!account) return NextResponse.json({ ok: false, error: "No account" }, { status: 404 });
  const docs = await listClientKyc(account.id);
  return NextResponse.json({ ok: true, docs });
}

export async function POST(req: Request) {
  const s = await requireClient();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const account = await clientAccount(s.tenantId!, s.sub);
    if (!account) throw new Error("No account");
    const form = await req.formData();
    const docType = String(form.get("docType") || "document");
    const file = form.get("file") as File | null;
    const back = form.get("back") as File | null;
    if (!file || file.size === 0) throw new Error("Identity Document (front) is required");
    if (!back || back.size === 0) throw new Error("Address Proof (back) is required — both documents must be uploaded");
    const key = await saveUpload(file, "kyc/" + account.id);
    const backKey = await saveUpload(back, "kyc/" + account.id);
    const doc = await createKyc(account.id, docType, key, backKey);
    await notifyTenantAdmins(s.tenantId!, "New KYC submitted", account.login + " uploaded " + docType + " (front + back)");
    await audit(s.tenantId!, "kyc.submit", account.login + " uploaded " + docType + " (front + back)", s.email || account.login, "CLIENT");
    return NextResponse.json({ ok: true, doc });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Upload failed" }, { status: 400 });
  }
}

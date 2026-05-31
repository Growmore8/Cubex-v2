import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { createKyc } from "@/services/kyc.service";
import { saveUpload } from "@/lib/upload";
import { audit } from "@/lib/audit";

export async function POST(req: Request) {
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const form = await req.formData();
    const accountId = String(form.get("accountId") || "");
    const login = String(form.get("login") || "");
    const docType = String(form.get("docType") || "document");
    const file = form.get("file") as File | null;
    if (!file || file.size === 0) throw new Error("File required");
    const account = accountId
      ? await prisma.account.findFirst({ where: { id: accountId, tenantId: s.tenantId! } })
      : login
      ? await prisma.account.findFirst({ where: { login, tenantId: s.tenantId! } })
      : null;
    if (!account) throw new Error("Client account not found");
    const key = await saveUpload(file, "kyc/" + account.id);
    const doc = await createKyc(account.id, docType, key);
    await audit(s.tenantId!, "kyc.upload", account.login + " " + docType, s.email);
    return NextResponse.json({ ok: true, doc });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Upload failed" }, { status: 400 });
  }
}
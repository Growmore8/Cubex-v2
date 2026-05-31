import { NextResponse } from "next/server";
import { requireClient } from "@/lib/guard";
import { clientAccount } from "@/services/kyc.service";
import { listClientPayments, createPayment } from "@/services/payment.service";
import { notifyTenantAdmins } from "@/services/notification.service";
import { saveUpload } from "@/lib/upload";

export async function GET() {
  const s = await requireClient();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const account = await clientAccount(s.tenantId!, s.sub);
  if (!account) return NextResponse.json({ ok: false, error: "No account" }, { status: 404 });
  const requests = await listClientPayments(account.id);
  return NextResponse.json({ ok: true, requests });
}

export async function POST(req: Request) {
  const s = await requireClient();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const account = await clientAccount(s.tenantId!, s.sub);
    if (!account) throw new Error("No account");
    const form = await req.formData();
    const kind = String(form.get("kind"));
    const amount = Number(form.get("amount"));
    const method = form.get("method") ? String(form.get("method")) : undefined;
    const note = form.get("note") ? String(form.get("note")) : undefined;
    if (!["DEPOSIT", "WITHDRAWAL"].includes(kind)) throw new Error("Invalid kind");
    if (!(amount > 0)) throw new Error("Amount must be positive");
    let slipUrl: string | undefined;
    const file = form.get("file") as File | null;
    if (file && file.size > 0) slipUrl = await saveUpload(file, "slips/" + account.id);
    await createPayment(s.tenantId!, account.id, kind, amount, method, slipUrl, note);
    await notifyTenantAdmins(s.tenantId!, kind + " request", account.login + " requested " + amount);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Request failed" }, { status: 400 });
  }
}

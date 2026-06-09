import { NextResponse } from "next/server";
import { requireClient } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { clientAccount } from "@/services/kyc.service";
import { listClientPayments, createPayment } from "@/services/payment.service";
import { notifyStaff } from "@/services/notification.service";
import { saveUpload } from "@/lib/upload";
import { audit } from "@/lib/audit";
import { getFundsPnlOnly, withdrawableBalance } from "@/services/fundSettings.service";

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
    const form = await req.formData();
    // Resolve the SELECTED account (validated to belong to this client), so the
    // request is recorded against — and the balance checked for — that account,
    // not a default/other one.
    const reqAccId = form.get("accountId") ? String(form.get("accountId")) : "";
    let account: any = reqAccId
      ? await prisma.account.findFirst({ where: { id: reqAccId, tenantId: s.tenantId!, userId: s.sub } })
      : null;
    if (!account) account = await clientAccount(s.tenantId!, s.sub);
    if (!account) throw new Error("No account");
    const kind = String(form.get("kind"));
    const amount = Number(form.get("amount"));
    const method = form.get("method") ? String(form.get("method")) : undefined;
    const note = form.get("note") ? String(form.get("note")) : undefined;
    if (!["DEPOSIT", "WITHDRAWAL"].includes(kind)) throw new Error("Invalid kind");
    if (!(amount > 0)) throw new Error("Amount must be positive");
    if (kind === "WITHDRAWAL") {
      const pnlOnly = await getFundsPnlOnly(s.tenantId!);
      const movable = withdrawableBalance(account as any, pnlOnly);
      if (amount > movable) throw new Error(pnlOnly ? `Only your profit (PNL) balance is withdrawable (max ${movable.toFixed(2)})` : "Insufficient balance");
    }
    let slipUrl: string | undefined;
    const file = form.get("file") as File | null;
    if (file && file.size > 0) slipUrl = await saveUpload(file, "slips/" + account.id);
    await createPayment(s.tenantId!, account.id, kind, amount, method, slipUrl, note);
    await audit(s.tenantId!, "payment.request", account.login + " " + kind + " " + amount + (method ? " via " + method : ""), s.email || account.login, "CLIENT");
    await notifyStaff(s.tenantId!, { type: "FUNDS", title: kind === "DEPOSIT" ? "Deposit request" : "Withdrawal request", body: account.login + " requested " + amount }, (account as any).managerId);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Request failed" }, { status: 400 });
  }
}

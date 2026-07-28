import { NextResponse } from "next/server";
import { requireClient } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { clientAccount } from "@/services/kyc.service";
import { listClientPayments, createPayment } from "@/services/payment.service";
import { notifyStaff } from "@/services/notification.service";
import { saveUpload } from "@/lib/upload";
import { audit } from "@/lib/audit";
import { getFundsPnlOnly, withdrawableBalance } from "@/services/fundSettings.service";
import { sendTenantSms } from "@/lib/sms";

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
    // No explicit account → prefer the oldest LIVE account (never default to the
    // demo for money operations), falling back to any account only as a last resort.
    if (!account) account = await prisma.account.findFirst({ where: { tenantId: s.tenantId!, userId: s.sub, type: "LIVE" }, orderBy: { createdAt: "asc" } });
    if (!account) account = await clientAccount(s.tenantId!, s.sub);
    if (!account) throw new Error("No account");
    const kind = String(form.get("kind"));
    const amount = Number(form.get("amount"));
    const method = form.get("method") ? String(form.get("method")) : undefined;
    const note = form.get("note") ? String(form.get("note")) : undefined;
    if (!["DEPOSIT", "WITHDRAWAL", "CREDIT_REQUEST", "CREDIT_CLEAR"].includes(kind)) throw new Error("Invalid kind");
    if (!(amount > 0)) throw new Error("Amount must be positive");
    // Demo accounts have no real funds — no deposits/withdrawals/credit.
    if (account.type === "DEMO") throw new Error("This action is not available for demo accounts.");
    // CREDIT_REQUEST: 250–1000, one pending at a time
    if (kind === "CREDIT_REQUEST") {
      if (amount < 250 || amount > 1000) throw new Error("Instant credit amount must be between $250 and $1,000");
      const existing = await prisma.paymentRequest.findFirst({ where: { accountId: account.id, kind: "CREDIT_REQUEST" as any, status: "PENDING" } });
      if (existing) throw new Error("You already have a pending credit request. Please wait for approval or cancel it.");
    }
    // CREDIT_CLEAR: only if there is outstanding credit
    if (kind === "CREDIT_CLEAR") {
      if (Number(account.credit) <= 0) throw new Error("No outstanding credit to clear.");
    }
    if (kind === "WITHDRAWAL") {
      if (Number(account.credit) > 0) throw new Error("Please clear your outstanding credit before making a withdrawal.");
      const pnlOnly = await getFundsPnlOnly(s.tenantId!);
      const movable = withdrawableBalance(account as any, pnlOnly);
      if (amount > movable) throw new Error(pnlOnly ? `Only your profit (PNL) balance is withdrawable (max ${movable.toFixed(2)})` : "Insufficient balance");
    }
    let slipUrl: string | undefined;
    const file = form.get("file") as File | null;
    if (file && file.size > 0) slipUrl = await saveUpload(file, "slips/" + account.id);
    await createPayment(s.tenantId!, account.id, kind, amount, method, slipUrl, note);
    const kindLabel: Record<string, string> = { DEPOSIT: "Deposit request", WITHDRAWAL: "Withdrawal request", CREDIT_REQUEST: "Instant Credit request", CREDIT_CLEAR: "Credit Clearance request" };
    await audit(s.tenantId!, "payment.request", account.login + " " + kind + " " + amount + (method ? " via " + method : ""), s.email || account.login, "CLIENT");
    await notifyStaff(s.tenantId!, { type: "FUNDS", title: kindLabel[kind] || kind, body: account.login + " requested $" + amount }, (account as any).managerId);
    sendTenantSms(s.tenantId!, (kindLabel[kind] || kind) + ": " + account.login + " requested $" + amount).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Request failed" }, { status: 400 });
  }
}

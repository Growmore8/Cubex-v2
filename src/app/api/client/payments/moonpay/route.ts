import { NextResponse } from "next/server";
import { requireClient } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { getMoonPayUrl, networkToCurrencyCode } from "@/lib/moonpay";
import { Prisma } from "@prisma/client";

export async function POST(req: Request) {
  const s = await requireClient();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const { amount, network, accountId } = await req.json();
    const net = (network || "TRC20").toUpperCase();
    const amt = Number(amount);
    if (!(amt > 0)) throw new Error("Enter a valid amount");

    // Resolve account — must be LIVE and belong to this client
    const account = accountId
      ? await prisma.account.findFirst({ where: { id: accountId, tenantId: s.tenantId!, userId: s.sub, type: "LIVE" } })
      : await prisma.account.findFirst({ where: { tenantId: s.tenantId!, userId: s.sub, type: "LIVE" }, orderBy: { createdAt: "asc" } });
    if (!account) throw new Error("No live account found");

    // Find the matching wallet address for this tenant + network
    const wallet = await prisma.cryptoWallet.findFirst({
      where: { active: true, network: net, type: "CRYPTO", OR: [{ tenantId: s.tenantId! }, { tenantId: null }] },
      orderBy: { tenantId: "desc" }, // prefer tenant-specific over global
    });
    if (!wallet) throw new Error("No " + net + " wallet configured. Please contact support.");

    // Create pending deposit request — id becomes the externalTransactionId for MoonPay
    const req2 = await prisma.paymentRequest.create({
      data: {
        tenantId: s.tenantId!,
        accountId: account.id,
        kind: "DEPOSIT" as any,
        amount: new Prisma.Decimal(amt),
        method: "MoonPay Card (" + net + ")",
        note: "Card payment via MoonPay — awaiting blockchain confirmation",
        details: { network: net, walletAddress: wallet.address, moonpayTxId: null } as any,
      },
    });

    const url = getMoonPayUrl({
      walletAddress: wallet.address,
      currencyCode: networkToCurrencyCode(net),
      externalTransactionId: req2.id,
      baseCurrencyAmount: amt,
      email: s.email ?? undefined,
    });

    return NextResponse.json({ ok: true, url, requestId: req2.id });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}

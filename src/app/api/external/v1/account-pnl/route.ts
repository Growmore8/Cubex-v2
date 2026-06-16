import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiKey } from "@/lib/apiKey";
import { rateLimit } from "@/lib/rateLimit";
import { runningContext } from "@/lib/livePrices";
import { pnlFor } from "@/lib/trademath";

// Public, read-only, server-to-server endpoint.
// GET /api/external/v1/account-pnl?accountId=900050
// Header: x-api-key: ck_live_xxxxxxxx   (or Authorization: Bearer ck_live_...)
// Returns the account's closed P&L, floating (open-trade) P&L and total,
// scoped to the key's tenant.
export async function GET(req: Request) {
  const auth = await requireApiKey(req);
  if (!auth) return NextResponse.json({ ok: false, error: "Invalid or missing API key" }, { status: 401 });

  // Per-key rate limit: 120 requests / minute.
  if (!rateLimit(`apikey:${auth.keyId}`, 120, 60_000)) {
    return NextResponse.json({ ok: false, error: "Rate limit exceeded" }, { status: 429 });
  }

  const accountId = (new URL(req.url).searchParams.get("accountId") || "").trim();
  if (!accountId) return NextResponse.json({ ok: false, error: "accountId is required" }, { status: 400 });

  // Look up by login (the account number), scoped to the key's tenant so a key
  // can only ever read its own tenant's accounts. Include open trades for floating.
  const account = await prisma.account.findFirst({
    where: { tenantId: auth.tenantId, login: accountId },
    select: { login: true, pnl: true, currency: true, trades: { select: { symbol: true, type: true, openPrice: true, lots: true } } },
  });
  if (!account) return NextResponse.json({ ok: false, error: "Account not found" }, { status: 404 });

  const closedPnl = Number(account.pnl);

  // Floating P&L from open trades, using the same live prices + trade math as
  // the terminal/statements. Symbols with no current price are skipped.
  const { prices, catOf } = await runningContext(auth.tenantId, account.trades.map((t) => t.symbol));
  const floatingPnl = account.trades.reduce((sum, o) => {
    const cur = prices[o.symbol];
    if (cur == null) return sum;
    return sum + pnlFor(o.symbol, o.type as "BUY" | "SELL", Number(o.openPrice), cur, Number(o.lots), catOf[o.symbol]);
  }, 0);

  const round = (n: number) => Math.round(n * 100) / 100;
  return NextResponse.json({
    ok: true,
    accountId: account.login,
    pnl: round(closedPnl), // closed P&L (back-compat: this field was closed P&L)
    closedPnl: round(closedPnl),
    floatingPnl: round(floatingPnl),
    totalPnl: round(closedPnl + floatingPnl),
    currency: account.currency || "USD",
  });
}

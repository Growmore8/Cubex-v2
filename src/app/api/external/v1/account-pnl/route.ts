import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiKey } from "@/lib/apiKey";
import { rateLimit } from "@/lib/rateLimit";

// Public, read-only, server-to-server endpoint.
// GET /api/external/v1/account-pnl?accountId=900050
// Header: x-api-key: ck_live_xxxxxxxx   (or Authorization: Bearer ck_live_...)
// Returns the account's CLOSED P&L, scoped to the key's tenant.
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
  // can only ever read its own tenant's accounts.
  const account = await prisma.account.findFirst({
    where: { tenantId: auth.tenantId, login: accountId },
    select: { login: true, pnl: true, currency: true },
  });
  if (!account) return NextResponse.json({ ok: false, error: "Account not found" }, { status: 404 });

  return NextResponse.json({
    ok: true,
    accountId: account.login,
    pnl: Number(account.pnl),
    currency: account.currency || "USD",
  });
}

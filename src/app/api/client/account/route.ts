import { NextResponse } from "next/server";
import { getClientSession } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { getDisabledSetFor } from "@/services/symbolPerms.service";
import { getFundsPnlOnly, withdrawableBalance } from "@/services/fundSettings.service";
import { getAccountFxRate } from "@/lib/prices";
import { audit } from "@/lib/audit";
import { Prisma } from "@prisma/client";

export async function GET(req: Request) {
  const { session: s, suspended } = await getClientSession();
  if (suspended) return NextResponse.json({ ok: false, code: "TENANT_SUSPENDED" }, { status: 403 });
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const reqAccId = url.searchParams.get("accountId");

  // Instant-logout on deactivation: if the client has no active (non-deactivated)
  // account, signal the client to log out.
  const activeCount = await prisma.account.count({ where: { tenantId: s.tenantId!, userId: s.sub, deactivated: false } });
  if (activeCount === 0) {
    const total = await prisma.account.count({ where: { tenantId: s.tenantId!, userId: s.sub } });
    if (total > 0) return NextResponse.json({ ok: false, code: "DEACTIVATED", error: "Your account has been deactivated. Please contact support." }, { status: 403 });
  }

  // Resolve the requested account, but never land on a deactivated one if an active exists.
  let account = await prisma.account.findFirst({
    where: reqAccId ? { tenantId: s.tenantId!, userId: s.sub, id: reqAccId, deactivated: false } : { tenantId: s.tenantId!, userId: s.sub, deactivated: false },
    orderBy: { createdAt: "asc" },
    include: {
      trades: { orderBy: { openedAt: "desc" } },
      history: { orderBy: { closedAt: "desc" }, take: 50 },
      financials: { orderBy: { appliedAt: "desc" }, take: 50 },
      user: { select: { name: true, email: true } },
    },
  });
  if (!account) {
    account = await prisma.account.findFirst({
      where: { tenantId: s.tenantId!, userId: s.sub, deactivated: false },
      orderBy: { createdAt: "asc" },
      include: {
        trades: { orderBy: { openedAt: "desc" } },
        history: { orderBy: { closedAt: "desc" }, take: 50 },
        financials: { orderBy: { appliedAt: "desc" }, take: 50 },
        user: { select: { name: true, email: true } },
      },
    });
  }

  // One identity per person: a client's name/email/phone/country are shared across
  // ALL their accounts (live + demo). Resolve each field from the oldest account that
  // has a value (oldest-first), so every linked account shows the same details — even
  // if a particular sub-account was created before the parent-linking existed.
  let ident: { name: string; email: string | null; phone: string | null; country: string | null } | null = null;
  if (account) {
    const sibs = await prisma.account.findMany({
      where: { tenantId: s.tenantId!, userId: s.sub },
      orderBy: { createdAt: "asc" },
      select: { name: true, email: true, phone: true, country: true },
    }).catch(() => [] as any[]);
    const firstOf = (k: "name" | "email" | "phone" | "country") => {
      for (const a of sibs) { const v = (a as any)[k]; if (v != null && String(v).trim() !== "") return v; }
      return null;
    };
    ident = { name: firstOf("name") || account.name, email: firstOf("email"), phone: firstOf("phone"), country: firstOf("country") };
  }
  const parentDisplay = ident;

  // User-level KYC: verified if any of the user's accounts has an approved document.
  // Only the parent/primary needs KYC; all linked accounts (incl. sub-accounts and
  // the client's own additional accounts) inherit it.
  // Pool accounts don't require KYC; everyone else needs an approved document.
  const kycVerified = (account as any)?.isPool ? true : !!(await prisma.kycDocument.findFirst({ where: { account: { userId: s.sub }, status: "APPROVED" }, select: { id: true } }));

  // Same global catalog as every other area, minus the symbols this client's tenant
  // admin / assigned managers have switched off (so an admin/manager "off" reflects
  // to the client). Identical filtering to /api/symbols.
  let symbols: any[] = [];
  try {
    symbols = await prisma.globalSymbol.findMany({
      where: { enabled: true },
      orderBy: { symbol: "asc" },
      select: { symbol: true, display: true, category: true, digits: true },
    });
    const hidden = await getDisabledSetFor(s);
    // Per-account overrides: a symbol the admin switched off for THIS specific account.
    const ovr = account ? await prisma.accountSymbolOverride.findMany({ where: { accountId: account.id, disabled: true }, select: { symbol: true } }) : [];
    for (const o of ovr) hidden.add(o.symbol);
    if (hidden.size) symbols = symbols.filter((x: any) => !hidden.has(x.symbol));
  } catch { symbols = []; }

  // Spread data: per-symbol (fixed/floating) + group markup + account markup
  let symbolSpreads: Record<string, { min: number; max: number; type: string }> = {};
  let groupSpread = 0;
  let accountSpreadMarkup = 0;
  try {
    const tenantSyms = await prisma.symbol.findMany({ where: { tenantId: s.tenantId! }, select: { symbol: true, spread: true, spreadType: true, spreadMax: true } });
    for (const ts of tenantSyms) symbolSpreads[ts.symbol] = { min: Number(ts.spread ?? 0), max: Number(ts.spreadMax ?? 0), type: ts.spreadType || "FLOATING" };
    if (account && (account as any).groupId) {
      const grp = await prisma.tradeGroup.findUnique({ where: { id: (account as any).groupId }, select: { spread: true, spreadType: true } });
      // FIXED = apply configured pip markup. FLOATING = live exchange spread, no extra markup.
      // Default to FIXED so groups without explicit type still apply their spread.
      groupSpread = (grp?.spreadType ?? "FIXED") === "FIXED" ? Number(grp?.spread ?? 0) : 0;
    }
    if (account) accountSpreadMarkup = Number((account as any).spreadMarkup ?? 0);
  } catch {}

  // tenant branding for the app header (never "CubeX")
  let brand: { name: string; logoUrl: string | null; primaryColor: string | null; accentColor: string | null } = { name: "", logoUrl: null, primaryColor: null, accentColor: null };
  try {
    const t = await prisma.tenant.findUnique({ where: { id: s.tenantId! }, select: { name: true, brandName: true, logoUrl: true, primaryColor: true, accentColor: true, swapEnabled: true } });
    if (t) { brand = { name: t.brandName || t.name, logoUrl: t.logoUrl, primaryColor: (t as any).primaryColor || null, accentColor: (t as any).accentColor || null }; (brand as any).swapEnabled = !!(t as any).swapEnabled; }
  } catch {}

  // Auto-deduct expired bonus
  if (account && Number((account as any).bonus || 0) > 0 && (account as any).bonusExpiryAt && new Date((account as any).bonusExpiryAt) < new Date()) {
    const bonusAmt = Number((account as any).bonus);
    try {
      await prisma.$transaction([
        prisma.account.update({ where: { id: account.id }, data: { bonus: new Prisma.Decimal(0) } }),
        prisma.financialHistory.create({ data: { accountId: account.id, type: "BONUS", amount: new Prisma.Decimal(-bonusAmt), description: "Bonus expired", mode: "REALTIME", createdBy: "system" } }),
      ]);
      await audit(s.tenantId!, "bonus.expire", account.login + " bonus expired $" + bonusAmt, "system");
      // Refresh account after bonus deduction
      (account as any).bonus = new Prisma.Decimal(0);
    } catch {}
  }

  // Active instant credit request (PENDING) for this account
  const creditRequest = account ? await prisma.paymentRequest.findFirst({ where: { accountId: account.id, kind: "CREDIT_REQUEST" as any, status: "PENDING" }, select: { id: true, amount: true, status: true, createdAt: true } }).catch(() => null) : null;

  // Credit lock: credit outstanding and settlement due date passed
  const creditLocked = account && Number((account as any).credit || 0) > 0 && (account as any).creditSettleTo && new Date((account as any).creditSettleTo) < new Date();

  // Withdraw/transfer cap for THIS (selected) account, per tenant pnl-only setting.
  const pnlOnly = await getFundsPnlOnly(s.tenantId!).catch(() => false);
  const withdrawable = account ? withdrawableBalance(account as any, pnlOnly) : 0;

  // FX rate: USD per 1 unit of account currency (e.g. EURUSD for EUR accounts).
  // Sent to the client so live floating P&L can be displayed in account currency.
  const fxRate = account ? await getAccountFxRate(account.currency as string).catch(() => 1) : 1;

  return NextResponse.json({
    ok: true,
    kycVerified,
    fxRate,
    brand,
    swapEnabled: !!(brand as any).swapEnabled,
    pnlOnly,
    withdrawable,
    creditRequest: creditRequest ? { id: creditRequest.id, amount: Number(creditRequest.amount), status: creditRequest.status, createdAt: creditRequest.createdAt } : null,
    creditLocked: !!creditLocked,
    account: account ? {
      login: account.login, type: account.type, currency: account.currency, leverage: account.leverage,
      locked: account.locked || !!creditLocked,
      name: parentDisplay?.name || account.name,
      email: parentDisplay?.email || account.email || account.user?.email || null,
      phone: parentDisplay?.phone || account.phone || null, country: parentDisplay?.country || account.country || null,
      ownerName: account.user?.name || account.name,
      deposit: Number(account.deposit), withdrawal: Number(account.withdrawal),
      credit: Number(account.credit), bonus: Number(account.bonus), pnl: Number(account.pnl), insurance: Number((account as any).insurance || 0),
      creditSettleFrom: (account as any).creditSettleFrom || null,
      creditSettleTo: (account as any).creditSettleTo || null,
      bonusExpiryAt: (account as any).bonusExpiryAt || null,
    } : null,
    financials: account ? account.financials.map((f) => ({
      id: f.id.toString(), type: f.type, amount: Number(f.amount), description: f.description, appliedAt: f.appliedAt,
    })) : [],
    positions: account ? account.trades.map((t) => ({
      id: t.id.toString(), ticket: t.ticket.toString(), symbol: t.symbol, type: t.type,
      lots: Number(t.lots), openPrice: Number(t.openPrice), sl: Number(t.sl), tp: Number(t.tp),
      commission: Number((t as any).commission ?? 0), swap: Number((t as any).swap ?? 0),
      comment: (t as any).comment || null, trailingStop: Number((t as any).trailingStop ?? 0),
      masterTradeId: (t as any).masterTradeId ? String((t as any).masterTradeId) : null,
      openedAt: t.openedAt,
    })) : [],
    history: account ? account.history.map((h) => ({
      id: h.id.toString(), ticket: h.ticket.toString(), symbol: h.symbol, side: h.side, lots: Number(h.lots),
      openPrice: Number(h.openPrice), closePrice: Number(h.closePrice), pnl: Number(h.pnl),
      sl: Number(h.sl), tp: Number(h.tp),
      commission: Number((h as any).commission ?? 0), swap: Number((h as any).swap ?? 0),
      comment: (h as any).comment || null,
      closeReason: h.closeReason, openedAt: h.openedAt, closedAt: h.closedAt,
    })) : [],
    symbols,
    symbolSpreads,
    groupSpread,
    accountSpreadMarkup,
  });
}

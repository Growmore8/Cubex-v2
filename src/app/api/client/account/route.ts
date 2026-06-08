import { NextResponse } from "next/server";
import { requireClient } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { getDisabledSetFor } from "@/services/symbolPerms.service";

export async function GET(req: Request) {
  const s = await requireClient();
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
  const kycVerified = !!(await prisma.kycDocument.findFirst({ where: { account: { userId: s.sub }, status: "APPROVED" }, select: { id: true } }));

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
    if (hidden.size) symbols = symbols.filter((x: any) => !hidden.has(x.symbol));
  } catch { symbols = []; }

  // tenant branding for the app header (never "CubeX")
  let brand: { name: string; logoUrl: string | null } = { name: "", logoUrl: null };
  try {
    const t = await prisma.tenant.findUnique({ where: { id: s.tenantId! }, select: { name: true, brandName: true, logoUrl: true } });
    if (t) brand = { name: t.brandName || t.name, logoUrl: t.logoUrl };
  } catch {}

  return NextResponse.json({
    ok: true,
    kycVerified,
    brand,
    account: account ? {
      login: account.login, type: account.type, currency: account.currency, leverage: account.leverage, locked: account.locked,
      name: parentDisplay?.name || account.name,
      email: parentDisplay?.email || account.email || account.user?.email || null,
      phone: parentDisplay?.phone || account.phone || null, country: parentDisplay?.country || account.country || null,
      ownerName: account.user?.name || account.name,
      deposit: Number(account.deposit), withdrawal: Number(account.withdrawal),
      credit: Number(account.credit), bonus: Number(account.bonus), pnl: Number(account.pnl),
    } : null,
    financials: account ? account.financials.map((f) => ({
      id: f.id.toString(), type: f.type, amount: Number(f.amount), description: f.description, appliedAt: f.appliedAt,
    })) : [],
    positions: account ? account.trades.map((t) => ({
      id: t.id.toString(), ticket: t.ticket.toString(), symbol: t.symbol, type: t.type,
      lots: Number(t.lots), openPrice: Number(t.openPrice), sl: Number(t.sl), tp: Number(t.tp), openedAt: t.openedAt,
    })) : [],
    history: account ? account.history.map((h) => ({
      id: h.id.toString(), symbol: h.symbol, side: h.side, lots: Number(h.lots),
      openPrice: Number(h.openPrice), closePrice: Number(h.closePrice), pnl: Number(h.pnl),
      closeReason: h.closeReason, openedAt: h.openedAt, closedAt: h.closedAt,
    })) : [],
    symbols,
  });
}

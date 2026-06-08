import { NextResponse } from "next/server";
import { requireAdminOrManager } from "@/lib/guard";
import { listEnabled } from "@/services/globalSymbol.service";
import { getTenantDisabled, setTenantDisabled, getManagerDisabled, setManagerDisabled } from "@/services/symbolPerms.service";
import { audit } from "@/lib/audit";
import { emitRefresh } from "@/lib/realtime";

// GET: list all enabled symbols + the disabled set for the caller's scope.
export async function GET() {
  const s = await requireAdminOrManager();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const all = await listEnabled();
  const disabled = s.role === "MANAGER" ? await getManagerDisabled(s.sub) : await getTenantDisabled(s.tenantId!);
  return NextResponse.json({ ok: true, symbols: all, disabled, scope: s.role === "MANAGER" ? "manager" : "tenant" });
}

// POST { symbol, disabled }  — toggle one symbol for the caller's scope.
export async function POST(req: Request) {
  const s = await requireAdminOrManager();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const b = await req.json();
    const symbol = String(b.symbol || "");
    if (!symbol) throw new Error("symbol required");
    const isMgr = s.role === "MANAGER";
    const cur = isMgr ? await getManagerDisabled(s.sub) : await getTenantDisabled(s.tenantId!);
    const set = new Set(cur);
    if (b.disabled) set.add(symbol); else set.delete(symbol);
    const list = Array.from(set);
    if (isMgr) await setManagerDisabled(s.sub, list); else await setTenantDisabled(s.tenantId!, list);
    await audit(s.tenantId, "symbol.perm", `${symbol} ${b.disabled ? "off" : "on"} (${isMgr ? "manager" : "tenant"})`, s.email);
    // Realtime: tell open apps/desks to reload their (correctly-scoped) symbol list
    // immediately. Admin change reflects to all tenant clients; a manager change
    // only changes the set for that manager's own clients (resolved server-side).
    emitRefresh({ kind: "symbols", scope: isMgr ? "manager" : "tenant", managerId: isMgr ? s.sub : undefined, tenantId: s.tenantId });
    return NextResponse.json({ ok: true, disabled: list });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}

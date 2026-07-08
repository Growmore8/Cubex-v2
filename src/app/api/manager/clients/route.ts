import { NextResponse } from "next/server";
import { requireAdminOrManager } from "@/lib/guard";
import { listClients } from "@/services/account.service";

export async function GET() {
  const s = await requireAdminOrManager();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const clients = await listClients(s.tenantId!, s.role === "MANAGER" ? s.sub : null);
  return NextResponse.json({ ok: true, clients });
}

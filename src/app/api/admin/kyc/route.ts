import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/guard";
import { listTenantKyc } from "@/services/kyc.service";

export async function GET() {
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const docs = await listTenantKyc(s.tenantId!);
  return NextResponse.json({ ok: true, docs });
}

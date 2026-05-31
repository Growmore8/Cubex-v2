import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/guard";
import { listTenantPayments } from "@/services/payment.service";

export async function GET() {
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const requests = await listTenantPayments(s.tenantId!);
  return NextResponse.json({ ok: true, requests });
}

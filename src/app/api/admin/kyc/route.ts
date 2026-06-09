import { NextResponse } from "next/server";
import { requireAdminOrManager } from "@/lib/guard";
import { listTenantKyc } from "@/services/kyc.service";

export async function GET() {
  const s = await requireAdminOrManager();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  // Managers see only their own clients' KYC (read-only); admins see the tenant.
  const managerId = s.role === "MANAGER" ? s.sub : undefined;
  const docs = await listTenantKyc(s.tenantId!, managerId);
  return NextResponse.json({ ok: true, docs, canVerify: s.role !== "MANAGER" });
}

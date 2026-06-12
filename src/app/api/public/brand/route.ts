import { NextResponse } from "next/server";
import { getBrand } from "@/lib/brand";

// Public brand summary for the auth pages (no auth required).
export async function GET() {
  const b = await getBrand();
  return NextResponse.json({ ok: true, tenantId: b.tenantId, allowRegistration: b.allowRegistration, name: b.name, websiteUrl: b.websiteUrl });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { listTenants, createTenant } from "@/services/tenant.service";

async function guard() {
  const s = await getSession();
  return s && s.role === "SUPERADMIN" ? s : null;
}

export async function GET() {
  if (!(await guard())) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const tenants = await listTenants();
  return NextResponse.json({ ok: true, tenants });
}

const createSchema = z.object({
  name: z.string().min(2),
  subdomain: z.string().min(2).regex(/^[a-z0-9-]+$/, "lowercase letters, numbers, hyphens only"),
  adminName: z.string().min(2),
  adminEmail: z.string().email(),
  adminPassword: z.string().min(6),
  plan: z.enum(["STARTER", "PRO", "ENTERPRISE"]).optional(),
  seats: z.number().int().positive().optional(),
  brandName: z.string().optional(),
  primaryColor: z.string().optional(),
  accentColor: z.string().optional(),
  logoUrl: z.string().optional(),
  slogan: z.string().optional(),
  companyInfo: z.string().optional(),
});

export async function POST(req: Request) {
  if (!(await guard())) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const input = createSchema.parse(await req.json());
    const tenant = await createTenant(input);
    return NextResponse.json({ ok: true, tenant });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Create failed" }, { status: 400 });
  }
}

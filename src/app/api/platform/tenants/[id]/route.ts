import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { updateTenant, updateSubscription, deleteTenant } from "@/services/tenant.service";

async function guard() {
  const s = await getSession();
  return s && s.role === "SUPERADMIN" ? s : null;
}

const patchSchema = z.object({
  name: z.string().optional(),
  brandName: z.string().optional(),
  logoUrl: z.string().optional(),
  primaryColor: z.string().optional(),
  accentColor: z.string().optional(),
  supportEmail: z.string().optional(),
  status: z.enum(["ACTIVE", "SUSPENDED", "PENDING"]).optional(),
  customDomain: z.string().nullable().optional(),
  allowRegistration: z.boolean().optional(),
  subscription: z.object({
    plan: z.enum(["STARTER", "PRO", "ENTERPRISE"]).optional(),
    status: z.enum(["TRIALING", "ACTIVE", "PAST_DUE", "CANCELED"]).optional(),
    seats: z.number().int().positive().optional(),
  }).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await guard())) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const body = patchSchema.parse(await req.json());
    const { subscription, ...tenantData } = body;
    const tenant = await updateTenant(id, tenantData);
    if (subscription) await updateSubscription(id, subscription);
    return NextResponse.json({ ok: true, tenant });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Update failed" }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await guard())) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    await deleteTenant(id);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Delete failed" }, { status: 400 });
  }
}
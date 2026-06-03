import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/guard";
import { getClient, updateClient, deleteClient } from "@/services/account.service";
import { assertCan } from "@/lib/perms";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const c = await getClient(s.tenantId!, id);
  if (!c) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  const client = {
    id: c.id, login: c.login, name: c.name, type: c.type, leverage: c.leverage, currency: c.currency,
    locked: c.locked, doNotLiquidate: c.doNotLiquidate, mcLevel: Number(c.mcLevel), managerId: c.managerId, phone: c.phone, country: c.country, isPool: c.isPool, deactivated: c.deactivated,
    email: c.user?.email, deposit: Number(c.deposit), withdrawal: Number(c.withdrawal),
    credit: Number(c.credit), bonus: Number(c.bonus), pnl: Number(c.pnl),
    financials: c.financials.map((f) => ({ id: f.id.toString(), type: f.type, amount: Number(f.amount), description: f.description, appliedAt: f.appliedAt, createdBy: f.createdBy })),
  };
  return NextResponse.json({ ok: true, client });
}

const schema = z.object({
  leverage: z.number().int().positive().optional(),
  locked: z.boolean().optional(),
  doNotLiquidate: z.boolean().optional(),
  mcLevel: z.number().optional(),
  currency: z.enum(["USD", "EUR", "GBP"]).optional(),
  managerId: z.string().nullable().optional(), phone: z.string().optional(), country: z.string().optional(), isPool: z.boolean().optional(), deactivated: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const data = schema.parse(await req.json());
    const account = await updateClient(s.tenantId!, id, data, s.email);
    return NextResponse.json({ ok: true, account });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Update failed" }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    await assertCan(s, "deleteClients");
    await deleteClient(s.tenantId!, id, s.email);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Delete failed" }, { status: 400 });
  }
}
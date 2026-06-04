import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, requireAdminOrManager } from "@/lib/guard";
import { listClients, createClient } from "@/services/account.service";
import { assertCan } from "@/lib/perms";

export async function GET() {
  const s = await requireAdminOrManager();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const clients = await listClients(s.tenantId!, s.role === "MANAGER" ? s.sub : null);
  return NextResponse.json({ ok: true, clients });
}

const schema = z.object({
  name: z.string().min(2), email: z.string().email(), password: z.string().min(6),
  type: z.enum(["LIVE", "DEMO"]).optional(), leverage: z.number().int().positive().optional(),
  currency: z.enum(["USD", "EUR", "GBP"]).optional(), managerId: z.string().nullable().optional(), phone: z.string().optional(), country: z.string().optional(), isPool: z.boolean().optional(),
});

export async function POST(req: Request) {
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    await assertCan(s, "createClients");
    const input = schema.parse(await req.json());
    const account = await createClient(s.tenantId!, input, s.email);
    return NextResponse.json({ ok: true, account });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Create failed" }, { status: 400 });
  }
}

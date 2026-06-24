import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, requireAdminOrManager } from "@/lib/guard";
import { listClients, createClient } from "@/services/account.service";
import { assertCan } from "@/lib/perms";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const s = await requireAdminOrManager();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  // ?check=email — returns existing client info if the email is already registered
  const check = new URL(req.url).searchParams.get("check");
  if (check) {
    const user = await prisma.user.findFirst({
      where: { tenantId: s.tenantId!, email: check.toLowerCase().trim(), role: "CLIENT" },
      select: { name: true, id: true },
    });
    if (user) {
      const accountCount = await prisma.account.count({ where: { userId: user.id } });
      return NextResponse.json({ ok: true, exists: true, name: user.name, accounts: accountCount });
    }
    return NextResponse.json({ ok: true, exists: false });
  }

  const clients = await listClients(s.tenantId!, s.role === "MANAGER" ? s.sub : null);
  return NextResponse.json({ ok: true, clients });
}

const schema = z.object({
  // Pool accounts log in by Live ID and need no email — allow blank/missing email.
  name: z.string().min(2), email: z.union([z.string().email(), z.literal(""), z.undefined()]).optional(), password: z.string().min(6),
  type: z.enum(["LIVE", "DEMO"]).optional(), leverage: z.number().int().positive().optional(),
  currency: z.enum(["USD", "EUR", "GBP"]).optional(), managerId: z.string().nullable().optional(), phone: z.string().optional(), country: z.string().optional(), isPool: z.boolean().optional(),
}).refine((d) => d.isPool || (d.email && d.email.length > 0), { message: "Email is required", path: ["email"] });

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

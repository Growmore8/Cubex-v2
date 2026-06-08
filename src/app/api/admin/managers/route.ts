import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/guard";
import { assertCan } from "@/lib/perms";
import { listManagers, createManager } from "@/services/manager.service";
import { audit } from "@/lib/audit";
import { notifyStaff } from "@/services/notification.service";

export async function GET() {
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const managers = await listManagers(s.tenantId!);
  return NextResponse.json({ ok: true, managers });
}

const schema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  perms: z.record(z.string(), z.boolean()).optional(),
});

export async function POST(req: Request) {
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    await assertCan(s, "manageManagers");
    const input = schema.parse(await req.json());
    const manager = await createManager(s.tenantId!, input);
    await audit(s.tenantId!, "manager.create", input.name + " <" + input.email + ">", s.email || "admin");
    notifyStaff(s.tenantId!, { title: "Manager created", body: input.name + " (" + input.email + ")", type: "NOTICE" }).catch(() => {});
    return NextResponse.json({ ok: true, manager });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Create failed" }, { status: 400 });
  }
}

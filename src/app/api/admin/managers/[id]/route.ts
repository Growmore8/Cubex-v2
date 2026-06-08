import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/guard";
import { assertCan } from "@/lib/perms";
import { updateManager, deleteManager } from "@/services/manager.service";
import { audit } from "@/lib/audit";

const schema = z.object({
  name: z.string().optional(),
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED", "LOCKED"]).optional(),
  perms: z.record(z.string(), z.boolean()).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    await assertCan(s, "manageManagers");
    const data = schema.parse(await req.json());
    const manager = await updateManager(s.tenantId!, id, data);
    await audit(s.tenantId!, "manager.update", (manager.name || id) + " " + JSON.stringify({ ...data, password: data.password ? "***" : undefined }), s.email || "admin");
    return NextResponse.json({ ok: true, manager });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Update failed" }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    await assertCan(s, "manageManagers");
    await deleteManager(s.tenantId!, id);
    await audit(s.tenantId!, "manager.delete", id, s.email || "admin");
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Delete failed" }, { status: 400 });
  }
}
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/guard";
import { updateManager, deleteManager } from "@/services/manager.service";

const schema = z.object({
  name: z.string().optional(),
  status: z.enum(["ACTIVE", "SUSPENDED", "LOCKED"]).optional(),
  perms: z.record(z.string(), z.boolean()).optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const data = schema.parse(await req.json());
    const manager = await updateManager(s.tenantId!, params.id, data);
    return NextResponse.json({ ok: true, manager });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Update failed" }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    await deleteManager(s.tenantId!, params.id);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Delete failed" }, { status: 400 });
  }
}
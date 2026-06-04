import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/guard";
import { updateGroup, deleteGroup } from "@/services/group.service";

const schema = z.object({ name: z.string().optional(), spread: z.number().optional(), managerId: z.string().nullable().optional() });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try { await updateGroup(s.tenantId!, id, schema.parse(await req.json())); return NextResponse.json({ ok: true }); }
  catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 400 }); }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try { await deleteGroup(s.tenantId!, id); return NextResponse.json({ ok: true }); }
  catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 400 }); }
}
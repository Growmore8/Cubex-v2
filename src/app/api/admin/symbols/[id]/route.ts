import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/guard";
import { updateSymbol, deleteSymbol } from "@/services/symbol.service";

const schema = z.object({ display: z.string().optional(), category: z.string().optional(), digits: z.number().int().optional(), enabled: z.boolean().optional() });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try { await updateSymbol(s.tenantId!, id, schema.parse(await req.json())); return NextResponse.json({ ok: true }); }
  catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 400 }); }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try { await deleteSymbol(s.tenantId!, id); return NextResponse.json({ ok: true }); }
  catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 400 }); }
}
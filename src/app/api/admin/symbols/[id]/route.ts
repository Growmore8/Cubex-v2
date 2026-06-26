import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/guard";
import { updateSymbol, deleteSymbol } from "@/services/symbol.service";
import { Redis } from "ioredis";

const schema = z.object({ display: z.string().optional(), category: z.string().optional(), digits: z.number().int().optional(), spread: z.number().min(0).optional(), spreadType: z.enum(["FIXED", "FLOATING"]).optional(), spreadMax: z.number().min(0).optional(), enabled: z.boolean().optional() });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    await updateSymbol(s.tenantId!, id, schema.parse(await req.json()));
    // Notify server.js to reload spreads and push to all connected clients
    try { const pub = new Redis(process.env.REDIS_URL || "redis://localhost:6379"); await pub.publish("cubex:spreads", "1"); pub.disconnect(); } catch (_) {}
    return NextResponse.json({ ok: true });
  }
  catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 400 }); }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try { await deleteSymbol(s.tenantId!, id); return NextResponse.json({ ok: true }); }
  catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 400 }); }
}
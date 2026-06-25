import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/guard";
import { listSymbols, createSymbol } from "@/services/symbol.service";

export async function GET() {
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const symbols = await listSymbols(s.tenantId!);
  return NextResponse.json({ ok: true, symbols });
}

const schema = z.object({
  symbol: z.string().min(1), display: z.string().optional(), category: z.string().optional(),
  digits: z.number().int().optional(), spread: z.number().min(0).optional(),
  spreadType: z.enum(["FIXED", "FLOATING"]).optional(), spreadMax: z.number().min(0).optional(),
  enabled: z.boolean().optional(), feed: z.string().optional(),
});

export async function POST(req: Request) {
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try { const sym = await createSymbol(s.tenantId!, schema.parse(await req.json())); return NextResponse.json({ ok: true, symbol: sym }); }
  catch (e: any) { return NextResponse.json({ ok: false, error: (e.code === "P2002" ? "Already added" : (e.message || "Failed")) }, { status: 400 }); }
}

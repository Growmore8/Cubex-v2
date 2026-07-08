import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { notifyTenantClients } from "@/services/notification.service";
import { audit } from "@/lib/audit";

const schema = z.object({
  symbol: z.string().min(1),
  direction: z.enum(["BUY", "SELL"]),
  entryPrice: z.number().positive(),
  sl: z.number().min(0).default(0),
  tp: z.number().min(0).default(0),
  rationale: z.string().max(500).optional(),
});

export async function GET() {
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const signals = await prisma.signal.findMany({
    where: { tenantId: s.tenantId! },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ ok: true, signals });
}

export async function POST(req: Request) {
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const body = schema.parse(await req.json());
    const signal = await prisma.signal.create({
      data: {
        tenantId: s.tenantId!,
        symbol: body.symbol,
        direction: body.direction as any,
        entryPrice: body.entryPrice,
        sl: body.sl,
        tp: body.tp,
        rationale: body.rationale || null,
        createdBy: s.email,
      },
    });
    // Notify all clients about the new signal
    const dir = body.direction === "BUY" ? "📈 BUY" : "📉 SELL";
    await notifyTenantClients(
      s.tenantId!,
      `${dir} Signal: ${body.symbol}`,
      `Entry: ${body.entryPrice}${body.sl ? ` · SL: ${body.sl}` : ""}${body.tp ? ` · TP: ${body.tp}` : ""}${body.rationale ? `\n${body.rationale}` : ""}`,
    );
    await audit(s.tenantId!, "signal_publish", `${body.direction} ${body.symbol} @ ${body.entryPrice}`, s.email);
    return NextResponse.json({ ok: true, signal });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}

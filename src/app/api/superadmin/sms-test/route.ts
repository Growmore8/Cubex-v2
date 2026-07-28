import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  try {
    const { phone } = await req.json();
    if (!phone) throw new Error("Phone number required");

    const cfgRec = await prisma.setting.findUnique({ where: { key: "sa_config" } }).catch(() => null);
    const cfg = (cfgRec?.value as any) || {};
    if (!cfg.notifyLkUserId || !cfg.notifyLkApiKey) {
      throw new Error("Notify.lk credentials not configured. Save them first.");
    }

    const serviceId = (cfg.notifyLkServiceId as string || "").trim();
    const message = "CubeX test SMS — notification system working correctly.";

    const toPhone = String(phone).replace(/^\+/, "");
    const params = new URLSearchParams({
      user_id: String(cfg.notifyLkUserId),
      api_key: String(cfg.notifyLkApiKey),
      to: toPhone,
      message,
    });
    if (serviceId) params.set("service_id", serviceId);

    const res = await fetch("https://app.notify.lk/api/v1/send?" + params.toString());
    const text = await res.text().catch(() => "");
    if (!res.ok || text.toLowerCase().includes("error") || text.toLowerCase().includes("invalid")) {
      throw new Error("Notify.lk: " + (text || res.status));
    }
    return NextResponse.json({ ok: true, response: text });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}

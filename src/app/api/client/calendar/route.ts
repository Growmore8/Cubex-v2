import { NextResponse } from "next/server";
import { requireClient } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

async function getFinnhubKey(): Promise<string> {
  try {
    const rec = await prisma.setting.findUnique({ where: { key: "feeds" } });
    const v: any = (rec && rec.value) || {};
    if (typeof v.finnhubKey === "string" && v.finnhubKey.trim()) return v.finnhubKey.trim();
  } catch {}
  return process.env.FINNHUB_KEY || "";
}

export async function GET(req: Request) {
  const s = await requireClient();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  const token = await getFinnhubKey();
  if (!token) return NextResponse.json({ ok: true, events: [] }); // no key configured

  const url = new URL(req.url);
  const from = url.searchParams.get("from") || new Date().toISOString().slice(0, 10);
  const to   = url.searchParams.get("to")   || new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);

  try {
    const r = await fetch(
      `https://finnhub.io/api/v1/calendar/economic?from=${from}&to=${to}&token=${token}`,
      { next: { revalidate: 1800 } } // cache 30 min
    );
    if (!r.ok) return NextResponse.json({ ok: true, events: [] });
    const data = await r.json();
    const events = (data.economicCalendar || []).map((e: any) => ({
      time:     e.time || "",
      country:  e.country || "",
      event:    e.event || "",
      impact:   e.impact || "",
      actual:   e.actual ?? null,
      estimate: e.estimate ?? null,
      prev:     e.prev ?? null,
      unit:     e.unit || "",
    }));
    return NextResponse.json({ ok: true, events });
  } catch {
    return NextResponse.json({ ok: true, events: [] });
  }
}

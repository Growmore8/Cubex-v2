import { NextResponse } from "next/server";
import { requireClient } from "@/lib/guard";

// Forex Factory publish a free public JSON feed updated hourly.
// Times are US Eastern — convert to UTC so the client can render in local tz.
function toUtcString(date: string, time: string): string | null {
  try {
    // date = "Jan 14, 2025", time = "8:30am" | "All Day" | "Tentative"
    const d = new Date(date + " UTC");
    if (isNaN(d.getTime())) return null;
    const Y = d.getUTCFullYear(), Mo = d.getUTCMonth(), D = d.getUTCDate();
    const lower = (time || "").toLowerCase().trim();
    if (!lower || lower === "all day" || lower === "tentative") {
      return `${Y}-${String(Mo + 1).padStart(2, "0")}-${String(D).padStart(2, "0")} 00:00:00`;
    }
    const m = lower.match(/^(\d{1,2}):(\d{2})(am|pm)$/);
    if (!m) return null;
    let h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    if (m[3] === "pm" && h !== 12) h += 12;
    if (m[3] === "am" && h === 12) h = 0;
    // ET→UTC: EDT (Apr–Oct) = +4h, EST (Nov–Mar) = +5h
    h += Mo >= 3 && Mo <= 9 ? 4 : 5;
    const dt = new Date(Date.UTC(Y, Mo, D, h, min, 0));
    return dt.toISOString().slice(0, 19).replace("T", " ");
  } catch { return null; }
}

const FF_URLS = [
  "https://nfs.faireconomy.media/ff_calendar_thisweek.json",
  "https://nfs.faireconomy.media/ff_calendar_nextweek.json",
];

export async function GET() {
  const s = await requireClient();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const results = await Promise.allSettled(
      FF_URLS.map((u) => fetch(u, { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: 3600 } }).then((r) => r.json()))
    );
    const events: any[] = [];
    for (const r of results) {
      if (r.status !== "fulfilled" || !Array.isArray(r.value)) continue;
      for (const ev of r.value) {
        events.push({
          time:     toUtcString(ev.date, ev.time),
          impact:   (ev.impact || "").toLowerCase(),
          event:    ev.title || "",
          country:  ev.country || "",
          actual:   ev.actual && ev.actual !== "" ? ev.actual : null,
          estimate: ev.forecast && ev.forecast !== "" ? ev.forecast : null,
          prev:     ev.previous && ev.previous !== "" ? ev.previous : null,
          unit:     "",
        });
      }
    }
    // Sort chronologically; null times (all-day) sort to start of their date.
    events.sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""));
    return NextResponse.json({ ok: true, events });
  } catch {
    return NextResponse.json({ ok: true, events: [] });
  }
}

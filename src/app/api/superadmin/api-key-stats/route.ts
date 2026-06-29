import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import Redis from "ioredis";

function redisClient(): Redis | null {
  try { return new Redis(process.env.REDIS_URL || "redis://localhost:6379"); } catch { return null; }
}

// Returns hourly (last 24h), daily (last 30d), monthly (last 12m) usage for a key.
export async function GET(req: Request) {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  const keyId = new URL(req.url).searchParams.get("keyId");
  if (!keyId) return NextResponse.json({ ok: false, error: "keyId required" }, { status: 400 });

  const r = redisClient();
  if (!r) return NextResponse.json({ ok: true, hourly: [], daily: [], monthly: [] });

  try {
    const now = new Date();

    // Last 24 hours
    const hourKeys: string[] = [];
    for (let i = 23; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 3600000);
      hourKeys.push(`apiusage:${keyId}:h:${d.toISOString().slice(0, 13)}`);
    }

    // Last 30 days
    const dayKeys: string[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000);
      dayKeys.push(`apiusage:${keyId}:d:${d.toISOString().slice(0, 10)}`);
    }

    // Last 12 months
    const monthKeys: string[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      monthKeys.push(`apiusage:${keyId}:m:${d.toISOString().slice(0, 7)}`);
    }

    const [hVals, dVals, mVals] = await Promise.all([
      r.mget(...hourKeys),
      r.mget(...dayKeys),
      r.mget(...monthKeys),
    ]);

    const hourly = hourKeys.map((k, i) => ({
      label: k.split(":h:")[1].slice(11) + ":00", // "14:00"
      value: parseInt(hVals[i] || "0"),
    }));
    const daily = dayKeys.map((k, i) => ({
      label: k.split(":d:")[1].slice(5), // "06-29"
      value: parseInt(dVals[i] || "0"),
    }));
    const monthly = monthKeys.map((k, i) => ({
      label: k.split(":m:")[1], // "2026-06"
      value: parseInt(mVals[i] || "0"),
    }));

    r.disconnect();
    return NextResponse.json({ ok: true, hourly, daily, monthly });
  } catch {
    r.disconnect();
    return NextResponse.json({ ok: true, hourly: [], daily: [], monthly: [] });
  }
}

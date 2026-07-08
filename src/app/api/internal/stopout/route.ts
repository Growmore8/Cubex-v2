import { NextResponse } from "next/server";
import { runStopOut } from "@/services/stopout.service";

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

async function handle(req: Request) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    // Optional: filter to a single tenant via ?tenantId=...
    const url = new URL(req.url);
    const tenantId = url.searchParams.get("tenantId") ?? undefined;
    const result = await runStopOut(tenantId);
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

// GET — Vercel Cron / monitoring
export const GET = handle;
// POST — operator manual trigger
export const POST = handle;

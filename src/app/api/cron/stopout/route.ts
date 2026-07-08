import { NextResponse } from "next/server";
import { runStopOut } from "@/services/stopout.service";

// Accepts both a Bearer token (Vercel Cron) and an x-cron-secret header (internal calls).
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return (
    req.headers.get("authorization") === `Bearer ${secret}` ||
    req.headers.get("x-cron-secret") === secret
  );
}

async function handle(req: Request) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const result = await runStopOut();
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

// GET — called by Vercel Cron every minute
export const GET = handle;
// POST — manual operator trigger
export const POST = handle;

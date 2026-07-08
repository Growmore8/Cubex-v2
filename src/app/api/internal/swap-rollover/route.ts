import { NextResponse } from "next/server";
import { runSwapRollover } from "@/services/swap.service";

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

async function handle(req: Request) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const result = await runSwapRollover();
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

// GET — Vercel Cron calls this at 21:00 UTC daily
export const GET = handle;
// POST — manual operator trigger
export const POST = handle;

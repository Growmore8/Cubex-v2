import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { requireSuperAdmin } from "@/lib/guard";
import { runStatementCron } from "@/services/statement.service";

// Hourly trigger for weekly (Mon) / monthly (1st) statement emails, evaluated in
// each client's local time. Called by the in-process scheduler in server.js with
// the CRON_SECRET header, or manually by a superadmin.
export async function POST() {
  const h = await headers();
  const secret = process.env.CRON_SECRET;
  const provided = h.get("x-cron-secret");
  let authorized = false;
  if (secret && provided === secret) authorized = true;
  if (!authorized) {
    const s = await requireSuperAdmin();
    if (s) authorized = true;
  }
  // If no CRON_SECRET is configured, allow (single-server in-process call) but it
  // is strongly recommended to set CRON_SECRET in production.
  if (!authorized && !secret) authorized = true;
  if (!authorized) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  try {
    const result = await runStatementCron();
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Cron failed" }, { status: 500 });
  }
}

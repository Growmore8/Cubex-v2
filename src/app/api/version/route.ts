import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// A token that changes on every deploy: the server process restarts on each
// Docker rebuild, so this module-level value is fresh per deployment. The client
// polls this and offers a one-tap reload when it changes (installed PWAs have no
// browser refresh button, so this is how they pick up new builds).
const BOOT = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

export async function GET() {
  return NextResponse.json({ v: BOOT }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { createHash, timingSafeEqual } from "crypto";

// Password stored in env so it never appears in source code.
// Set AUDIT_GATE_PASSWORD=<your-password> in .env on the server.
const GATE = process.env.AUDIT_GATE_PASSWORD || "";

export async function POST(req: Request) {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  if (!GATE) return NextResponse.json({ ok: false, error: "Gate not configured" }, { status: 503 });
  try {
    const { password } = await req.json();
    if (!password || typeof password !== "string") return NextResponse.json({ ok: false });
    const a = createHash("sha256").update(password).digest();
    const b = createHash("sha256").update(GATE).digest();
    const ok = a.length === b.length && timingSafeEqual(a, b);
    return NextResponse.json({ ok });
  } catch {
    return NextResponse.json({ ok: false });
  }
}

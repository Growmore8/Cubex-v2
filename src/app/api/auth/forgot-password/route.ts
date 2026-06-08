import { NextResponse } from "next/server";
import { z } from "zod";
import { headers } from "next/headers";
import { sendForgotPassword } from "@/services/auth.service";
import { rateLimit } from "@/lib/rateLimit";

const schema = z.object({ email: z.string().email() });

export async function POST(req: Request) {
  try {
    const { email } = schema.parse(await req.json());
    const h = await headers();
    const host = h.get("host");
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (!rateLimit(`forgotpw:${ip}`, 5, 60_000)) {
      return NextResponse.json({ ok: false, error: "Too many attempts. Please wait." }, { status: 429 });
    }
    await sendForgotPassword(host, email);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { headers } from "next/headers";
import { registerClient } from "@/services/auth.service";
import { signSession, SESSION_COOKIE } from "@/lib/jwt";
import { ROLE_HOME } from "@/config/roles";
import { rateLimit } from "@/lib/rateLimit";

const schema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  phone: z.string().optional(),
  country: z.string().optional(),
  type: z.enum(["DEMO", "LIVE"]).optional(),
  tenantSlug: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    const { name, email, password, phone, country, type, tenantSlug } = schema.parse(await req.json());
    const h = await headers();
    const host = h.get("host");
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
    if (!rateLimit(`register:${ip}`, 5, 60_000)) {
      return NextResponse.json({ ok: false, error: "Too many attempts. Please wait a minute." }, { status: 429 });
    }
    const result = await registerClient(host, name, email.toLowerCase(), password, phone, country, type, tenantSlug);
    if (result.needsVerification) {
      return NextResponse.json({ ok: true, needsVerification: true, email: result.email });
    }
    const token = await signSession(result);
    const res = NextResponse.json({ ok: true, redirect: ROLE_HOME[result.role], needsVerification: false });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
      path: "/", maxAge: 60 * 60 * 8,
    });
    return res;
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Registration failed" }, { status: 400 });
  }
}

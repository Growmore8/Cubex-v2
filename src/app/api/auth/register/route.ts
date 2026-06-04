import { NextResponse } from "next/server";
import { z } from "zod";
import { headers } from "next/headers";
import { registerClient } from "@/services/auth.service";
import { signSession, SESSION_COOKIE } from "@/lib/jwt";
import { ROLE_HOME } from "@/config/roles";

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
    const host = (await headers()).get("host");
    const session = await registerClient(host, name, email.toLowerCase(), password, phone, country, type, tenantSlug);
    const token = await signSession(session);
    const res = NextResponse.json({ ok: true, redirect: ROLE_HOME[session.role] });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
      path: "/", maxAge: 60 * 60 * 8,
    });
    return res;
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Registration failed" }, { status: 400 });
  }
}

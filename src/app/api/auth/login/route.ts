import { NextResponse } from "next/server";
import { z } from "zod";
import { headers } from "next/headers";
import { authenticate } from "@/services/auth.service";
import { signSession, SESSION_COOKIE } from "@/lib/jwt";
import { ROLE_HOME } from "@/config/roles";

const schema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function POST(req: Request) {
  try {
    const { email, password } = schema.parse(await req.json());
    const h = await headers();
    const host = h.get("host");
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || undefined;
    const session = await authenticate(host, email, password, ip);
    const token = await signSession(session);
    const res = NextResponse.json({
      ok: true,
      redirect: ROLE_HOME[session.role],
      user: { name: session.name, role: session.role },
    });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
      path: "/", maxAge: 60 * 60 * 8,
    });
    return res;
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Login failed" }, { status: 401 });
  }
}

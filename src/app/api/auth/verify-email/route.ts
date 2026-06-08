import { NextResponse } from "next/server";
import { z } from "zod";
import { headers } from "next/headers";
import { verifyEmail } from "@/services/auth.service";
import { signSession, SESSION_COOKIE } from "@/lib/jwt";
import { ROLE_HOME } from "@/config/roles";

const schema = z.object({ email: z.string().email(), token: z.string().min(1) });

export async function POST(req: Request) {
  try {
    const { email, token } = schema.parse(await req.json());
    const h = await headers();
    const host = h.get("host");
    const session = await verifyEmail(host, email, token);
    const jwt = await signSession(session);
    const res = NextResponse.json({ ok: true, redirect: ROLE_HOME[session.role] });
    res.cookies.set(SESSION_COOKIE, jwt, {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
      path: "/", maxAge: 60 * 60 * 8,
    });
    return res;
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Verification failed" }, { status: 400 });
  }
}

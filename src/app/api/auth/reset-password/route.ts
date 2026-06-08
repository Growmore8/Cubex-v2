import { NextResponse } from "next/server";
import { z } from "zod";
import { headers } from "next/headers";
import { resetPassword } from "@/services/auth.service";

const schema = z.object({ email: z.string().email(), token: z.string().min(1), password: z.string().min(6) });

export async function POST(req: Request) {
  try {
    const { email, token, password } = schema.parse(await req.json());
    const h = await headers();
    const host = h.get("host");
    await resetPassword(host, email, token, password);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Reset failed" }, { status: 400 });
  }
}

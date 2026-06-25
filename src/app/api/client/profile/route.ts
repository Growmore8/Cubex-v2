import { NextResponse } from "next/server";
import { requireClient } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const s = await requireClient();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const user = await (prisma.user.findUnique as any)({
    where: { id: s.sub },
    select: { name: true, email: true, phone: true, country: true },
  });
  return NextResponse.json({ ok: true, name: user?.name, email: user?.email, phone: user?.phone || null, country: user?.country || null });
}

export async function PATCH(req: Request) {
  const s = await requireClient();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const body = await req.json();
    const name = typeof body.name === "string" ? body.name.trim() : undefined;
    const phone = typeof body.phone === "string" ? body.phone.trim() : undefined;
    const country = typeof body.country === "string" ? body.country.trim() : undefined;
    if (!name || name.length < 2) throw new Error("Full name is required (min 2 characters)");
    if (!phone) throw new Error("Phone number is required");
    if (!country) throw new Error("Country is required");
    // Lock: if profile already complete, do not allow re-submission
    const existing = await (prisma.user.findUnique as any)({ where: { id: s.sub }, select: { phone: true, country: true } });
    if (existing?.phone && existing?.country) throw new Error("Profile already submitted and cannot be changed. Contact support if you need to update your details.");
    const data: any = { name, phone, country };
    await (prisma.user.update as any)({ where: { id: s.sub }, data });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Update failed" }, { status: 400 });
  }
}

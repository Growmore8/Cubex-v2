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
    if (name !== undefined && name.length < 2) throw new Error("Name must be at least 2 characters");
    const data: any = {};
    if (name !== undefined) data.name = name;
    if (phone !== undefined) data.phone = phone || null;
    if (country !== undefined) data.country = country || null;
    if (!Object.keys(data).length) throw new Error("Nothing to update");
    await (prisma.user.update as any)({ where: { id: s.sub }, data });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Update failed" }, { status: 400 });
  }
}

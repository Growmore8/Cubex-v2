import { NextResponse } from "next/server";
import { requireClient } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { saveUpload } from "@/lib/upload";

export async function GET() {
  const s = await requireClient();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const user = await prisma.user.findUnique({ where: { id: s.sub }, select: { avatarUrl: true } });
  return NextResponse.json({ ok: true, avatarUrl: user?.avatarUrl || "" });
}

export async function POST(req: Request) {
  const s = await requireClient();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) throw new Error("No file");
    const up = await saveUpload(file, "avatars");
    await prisma.user.update({ where: { id: s.sub }, data: { avatarUrl: up.fileUrl } });
    return NextResponse.json({ ok: true, avatarUrl: up.fileUrl });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}
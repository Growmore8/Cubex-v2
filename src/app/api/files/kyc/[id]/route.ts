import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readUpload, contentType } from "@/lib/upload";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s) return NextResponse.json({ ok: false }, { status: 401 });
  const doc = await prisma.kycDocument.findUnique({ where: { id: id }, include: { account: true } });
  if (!doc) return NextResponse.json({ ok: false }, { status: 404 });
  const acc = doc.account;
  const allowed =
    s.role === "SUPERADMIN" ||
    ((s.role === "ADMIN" || s.role === "MANAGER") && acc.tenantId === s.tenantId) ||
    (s.role === "CLIENT" && acc.userId === s.sub);
  if (!allowed) return NextResponse.json({ ok: false }, { status: 403 });
  const buf = await readUpload(doc.fileUrl);
  return new Response(new Uint8Array(buf), { headers: { "Content-Type": contentType(doc.fileUrl) } });
}
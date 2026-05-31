import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const docs = await prisma.kycDocument.findMany({
    orderBy: { createdAt: "desc" }, take: 300,
    include: { account: { select: { login: true, name: true, user: { select: { email: true, name: true } } } } },
  });
  const items = docs.map((d) => ({
    id: d.id, date: d.createdAt,
    accountId: d.account ? d.account.login : "—",
    name: d.account ? (d.account.name || (d.account.user ? d.account.user.name : "")) : "",
    email: d.account && d.account.user ? d.account.user.email : "",
    docType: d.docType, fileUrl: d.fileUrl, status: d.status,
  }));
  return NextResponse.json({ ok: true, items });
}
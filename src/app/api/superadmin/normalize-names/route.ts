import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { titleCaseName } from "@/lib/format";

// One-time, idempotent: capitalise the first letter of every stored user +
// account name (existing records), so all areas show Title-Case names. New /
// edited names are already normalised on save. Safe to re-run.
export async function GET() {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  let users = 0, accounts = 0;
  const allUsers = await prisma.user.findMany({ select: { id: true, name: true }, take: 100000 });
  for (const u of allUsers) {
    const nn = titleCaseName(u.name);
    if (nn && nn !== u.name) { await prisma.user.update({ where: { id: u.id }, data: { name: nn } }).catch(() => {}); users++; }
  }
  const allAccts = await prisma.account.findMany({ select: { id: true, name: true }, take: 100000 });
  for (const a of allAccts) {
    const nn = titleCaseName(a.name);
    if (nn && nn !== a.name) { await prisma.account.update({ where: { id: a.id }, data: { name: nn } }).catch(() => {}); accounts++; }
  }
  return NextResponse.json({ ok: true, usersFixed: users, accountsFixed: accounts });
}

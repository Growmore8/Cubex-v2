import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { adjustBalance, applyClientEmail } from "@/services/account.service";
import { audit } from "@/lib/audit";
import { titleCaseName } from "@/lib/format";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  try {
    const b = await req.json();
    const acc: any = await prisma.account.findUnique({ where: { id } });
    if (!acc) throw new Error("Account not found");

    if (b.action === "lock") {
      await prisma.account.update({ where: { id: acc.id }, data: { locked: true } });
    } else if (b.action === "unlock") {
      await prisma.account.update({ where: { id: acc.id }, data: { locked: false } });
    } else if (b.action === "deactivate") {
      await prisma.account.update({ where: { id: acc.id }, data: { deactivated: true } });
    } else if (b.action === "activate") {
      await prisma.account.update({ where: { id: acc.id }, data: { deactivated: false } });
    } else if (b.action === "pool") {
      await prisma.account.update({ where: { id: acc.id }, data: { isPool: !!b.promote } });
    } else if (b.action === "rename") {
      const data: any = {};
      if (b.name) data.name = titleCaseName(b.name);
      if (b.phone !== undefined) data.phone = b.phone || null;
      if (b.country !== undefined) data.country = b.country || null;
      if (Object.keys(data).length) {
        await prisma.account.update({ where: { id: acc.id }, data });
        // Sync name/phone/country to all sibling accounts (same user) — same behaviour as admin side
        if (acc.userId) await prisma.account.updateMany({ where: { userId: acc.userId, NOT: { id: acc.id } }, data }).catch(() => {});
      }
      // Email is the LOGIN identity — route it through the helper so it updates
      // User.email (source of truth) and repairs orphaned accounts.
      if (b.email !== undefined) await applyClientEmail(acc.tenantId, acc.id, b.email);
    } else if (b.action === "accountId") {
      const login = String(b.login || "").trim();
      if (!login) throw new Error("Login ID required");
      const clash = await prisma.account.findFirst({ where: { tenantId: acc.tenantId, login, NOT: { id: acc.id } } });
      if (clash) throw new Error("Login ID already in use");
      await prisma.account.update({ where: { id: acc.id }, data: { login } });
    } else if (b.action === "assignManager") {
      await prisma.account.update({ where: { id: acc.id }, data: { managerId: b.managerId || null } });
    } else if (b.action === "assignTenant") {
      const newTenantId = b.tenantId || null;
      if (!newTenantId) throw new Error("Tenant required");
      await prisma.$transaction(async (tx) => {
        await tx.account.update({ where: { id: acc.id }, data: { tenantId: newTenantId } });
        if (acc.userId) {
          const otherAccounts = await tx.account.count({ where: { userId: acc.userId, NOT: { id: acc.id } } });
          if (otherAccounts === 0) {
            await tx.user.update({ where: { id: acc.userId }, data: { tenantId: newTenantId } });
          }
        }
      });
    } else if (b.action === "balance") {
      await adjustBalance(acc.tenantId, acc.id, b.type, Number(b.amount), b.description || "", s.email);
    } else if (b.action === "resetPassword") {
      if (!acc.userId) throw new Error("No login user for this account");
      if (!b.password || b.password.length < 6) throw new Error("Password too short");
      await prisma.user.update({ where: { id: acc.userId }, data: { passwordHash: await hashPassword(b.password) } });
    } else if (b.action === "repairLogin") {
      // Rebuild the login identity for an orphaned account (its shared User was
      // deleted when another of the client's accounts was removed). Recreates/links
      // a User from the email and sets a password so the client can sign in again.
      const email = String(b.email || acc.email || "").trim().toLowerCase();
      if (!email) throw new Error("Set an email on this account first, then repair.");
      if (!b.password || b.password.length < 6) throw new Error("Password must be at least 6 characters");
      await applyClientEmail(acc.tenantId, acc.id, email); // recreate/link the User
      const fresh = await prisma.account.findUnique({ where: { id: acc.id }, select: { userId: true } });
      if (!fresh?.userId) throw new Error("Could not rebuild the login identity");
      await prisma.user.update({ where: { id: fresh.userId }, data: { passwordHash: await hashPassword(b.password) } });
    } else if (b.action === "delete") {
      await prisma.$transaction(async (tx) => {
        await tx.account.delete({ where: { id: acc.id } });
        // Only delete the shared login User when this was the client's LAST account,
        // else the remaining accounts get orphaned (userId SetNull → no identity).
        if (acc.userId) {
          const remaining = await tx.account.count({ where: { userId: acc.userId } });
          if (remaining === 0) await tx.user.delete({ where: { id: acc.userId } }).catch(() => {});
        }
      });
    } else {
      throw new Error("Unknown action");
    }

    const auditDetail = b.action === "balance"
      ? `${acc.login} ${b.type} $${b.amount}${b.description ? " — " + b.description : ""}`
      : acc.login;
    await audit(acc.tenantId, "sa.client." + b.action, auditDetail, s.email, "SUPERADMIN");
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}

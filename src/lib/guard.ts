import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { SessionPayload } from "@/types";

// Throws if the staff member is in read-only mode (User LOCKED or tenant SUSPENDED).
// Call at the top of mutating staff routes so locked accounts can view but not act.
export async function assertWritable(s: SessionPayload) {
  try {
    const u = await prisma.user.findUnique({ where: { id: s.sub }, select: { status: true } });
    if (u && u.status === "LOCKED") throw new Error("Your account is read-only (locked). Action not allowed.");
    if (s.tenantId) {
      const t = await prisma.tenant.findUnique({ where: { id: s.tenantId }, select: { status: true } });
      if (t && t.status === "SUSPENDED") throw new Error("This workspace is locked (read-only). Action not allowed.");
    }
  } catch (e: any) {
    if (e?.message?.includes("read-only")) throw e;
  }
}

export async function requireAdmin() {
  const s = await getSession();
  if (!s || s.role !== "ADMIN" || !s.tenantId) return null;
  return s;
}

export async function requireSuperAdmin() {
  const s = await getSession();
  return s && s.role === "SUPERADMIN" ? s : null;
}

export async function requireClient() {
  const s = await getSession();
  if (!s || s.role !== "CLIENT" || !s.tenantId) return null;
  return s;
}

export async function requireAdminOrManager() {
  const s = await getSession();
  if (!s || !s.tenantId) return null;
  if (s.role === "ADMIN" || s.role === "MANAGER") return s;
  return null;
}

export async function requireStaff() {
  const s = await getSession();
  if (!s || !s.tenantId) return null;
  if (s.role === "ADMIN" || s.role === "MANAGER" || s.role === "SUPERADMIN") return s;
  return null;
}

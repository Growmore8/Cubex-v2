import { getSession } from "@/lib/auth";

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

export async function requireStaff() {
  const s = await getSession();
  if (!s || !s.tenantId) return null;
  if (s.role === "ADMIN" || s.role === "MANAGER" || s.role === "SUPERADMIN") return s;
  return null;
}

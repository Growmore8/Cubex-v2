import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE } from "@/lib/jwt";
import { prisma } from "@/lib/prisma";
import type { SessionPayload } from "@/types";

export function hashPassword(pw: string) {
  return bcrypt.hash(pw, 10);
}

export function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}

export async function getSession(): Promise<SessionPayload | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await verifySession(token);
  if (!session) return null;

  // Single-device enforcement for staff: if this token's session id no longer
  // matches the user's active session, it was superseded by a newer login.
  const isStaff = session.role === "ADMIN" || session.role === "MANAGER" || session.role === "SUPERADMIN";
  if (isStaff && session.sid) {
    try {
      const u = await prisma.user.findUnique({ where: { id: session.sub }, select: { activeSession: true } });
      if (!u || (u.activeSession && u.activeSession !== session.sid)) return null;
    } catch {}
  }
  return session;
}

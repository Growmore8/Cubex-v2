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

// In-memory throttle so we update lastSeenAt at most once/45s per user (single Node
// server process), regardless of request volume — cheap presence heartbeat.
const lastBeat = new Map<string, number>();

// Cache staff activeSession DB check for 12s — avoids a DB hit on every request.
const _sessCache = new Map<string, { ok: boolean; exp: number }>();

export function invalidateSessionCache(userId: string) {
  for (const key of _sessCache.keys()) {
    if (key.startsWith(userId + ":")) _sessCache.delete(key);
  }
}
function beat(userId: string) {
  const now = Date.now();
  if (now - (lastBeat.get(userId) || 0) < 45000) return;
  lastBeat.set(userId, now);
  // Prune map when it grows large (one entry per user, never auto-deleted otherwise).
  if (lastBeat.size > 5000) {
    const sorted = [...lastBeat.entries()].sort((a, b) => a[1] - b[1]);
    for (const [k] of sorted.slice(0, 1000)) lastBeat.delete(k);
  }
  prisma.user.update({ where: { id: userId }, data: { lastSeenAt: new Date() } }).catch(() => {});
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
      const _cacheKey = session.sub + ":" + session.sid;
      const _cached = _sessCache.get(_cacheKey);
      let _sessOk: boolean;
      if (_cached && _cached.exp > Date.now()) {
        _sessOk = _cached.ok;
      } else {
        const u = await prisma.user.findUnique({ where: { id: session.sub }, select: { activeSession: true } });
        _sessOk = !u || !u.activeSession || u.activeSession === session.sid;
        _sessCache.set(_cacheKey, { ok: _sessOk, exp: Date.now() + 12000 }); // 12s TTL
      }
      if (!_sessOk) return null;
    } catch {}
  }
  beat(session.sub); // presence heartbeat (throttled, fire-and-forget)
  return session;
}

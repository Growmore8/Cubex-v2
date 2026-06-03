import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE } from "@/lib/jwt";
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
  return verifySession(token);
}

import { SignJWT, jwtVerify } from "jose";
import type { SessionPayload } from "@/types";

export const SESSION_COOKIE = "cubex_session";

function getSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET not set");
  return new TextEncoder().encode(s);
}

export async function signSession(payload: SessionPayload, expiresIn?: string) {
  return await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresIn || process.env.JWT_EXPIRES_IN || "8h")
    .sign(getSecret());
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

// Device-bound token for passwordless PIN sign-in. Set (httpOnly) after a
// successful password login so a PIN can only sign in on a device that has
// already authenticated with the full password at least once.
export const DEVICE_COOKIE = "cubex_device";

export async function signDeviceToken(userId: string) {
  return await new SignJWT({ uid: userId, kind: "device" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("180d")
    .sign(getSecret());
}

export async function verifyDeviceToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if ((payload as any).kind !== "device") return null;
    return (payload as any).uid as string;
  } catch {
    return null;
  }
}

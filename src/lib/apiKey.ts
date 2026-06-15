import crypto from "crypto";
import { prisma } from "@/lib/prisma";

// Server-to-server API keys for external integrations. We never store the raw
// key — only its sha256 hash + a short display prefix. The raw key is shown to
// the SuperAdmin once at creation and cannot be recovered (only regenerated).

const PREFIX = "ck_live_";

// Generate a fresh key. Returns the raw secret (show once), its hash (stored),
// and a short prefix used to identify it in the UI.
export function generateApiKey(): { raw: string; keyHash: string; prefix: string } {
  const raw = PREFIX + crypto.randomBytes(24).toString("hex");
  return { raw, keyHash: hashKey(raw), prefix: raw.slice(0, PREFIX.length + 4) + "…" };
}

export function hashKey(raw: string): string {
  return crypto.createHash("sha256").update(raw.trim()).digest("hex");
}

// Read the key from the request (x-api-key header, or "Authorization: Bearer ..").
export function readApiKey(req: Request): string | null {
  const x = req.headers.get("x-api-key");
  if (x && x.trim()) return x.trim();
  const auth = req.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

// Validate the request's API key. Returns the owning tenantId, or null if the
// key is missing/unknown/revoked. Stamps lastUsedAt (best-effort).
export async function requireApiKey(req: Request): Promise<{ tenantId: string; keyId: string } | null> {
  const raw = readApiKey(req);
  if (!raw) return null;
  const key = await prisma.apiKey.findUnique({ where: { keyHash: hashKey(raw) } });
  if (!key || !key.active) return null;
  prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  return { tenantId: key.tenantId, keyId: key.id };
}

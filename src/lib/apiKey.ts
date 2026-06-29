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
// key is missing/unknown/revoked. Stamps lastUsedAt + increments usage counters.
export async function requireApiKey(req: Request): Promise<{ tenantId: string; keyId: string } | null> {
  const raw = readApiKey(req);
  if (!raw) return null;
  const key = await prisma.apiKey.findUnique({ where: { keyHash: hashKey(raw) } });
  if (!key || !key.active) return null;
  prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  // Track usage in Redis — hourly (48h TTL), daily (90d TTL), monthly (2y TTL)
  trackApiUsage(key.id).catch(() => {});
  return { tenantId: key.tenantId, keyId: key.id };
}

async function trackApiUsage(keyId: string) {
  try {
    const Redis = (await import("ioredis")).default;
    const r = new Redis(process.env.REDIS_URL || "redis://localhost:6379");
    const now = new Date();
    const h = `${now.toISOString().slice(0, 13)}`; // "2026-06-29T14"
    const d = `${now.toISOString().slice(0, 10)}`;  // "2026-06-29"
    const m = `${now.toISOString().slice(0, 7)}`;   // "2026-06"
    const p = r.pipeline();
    p.incr(`apiusage:${keyId}:h:${h}`); p.expire(`apiusage:${keyId}:h:${h}`, 172800);   // 48h
    p.incr(`apiusage:${keyId}:d:${d}`); p.expire(`apiusage:${keyId}:d:${d}`, 7776000);  // 90d
    p.incr(`apiusage:${keyId}:m:${m}`); p.expire(`apiusage:${keyId}:m:${m}`, 63072000); // 2y
    await p.exec();
    r.disconnect();
  } catch {}
}

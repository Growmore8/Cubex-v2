// Simple in-memory rate limiter. Resets per process restart (acceptable for
// stateless Next.js deployments; for multi-instance setups use Redis).
interface Bucket { count: number; resetAt: number }
const store = new Map<string, Bucket>();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  let b = store.get(key);
  if (!b || now >= b.resetAt) { b = { count: 0, resetAt: now + windowMs }; store.set(key, b); }
  b.count++;
  return b.count <= limit;
}

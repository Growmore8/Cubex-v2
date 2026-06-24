import Redis from "ioredis";

const g = globalThis as unknown as { __redis?: Redis };

export const redis: Redis = g.__redis ?? new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: 1,   // fail fast — don't hang 20 retries on each request
  lazyConnect: true,          // don't connect until first command
  enableOfflineQueue: false,  // reject commands immediately when disconnected
});

if (process.env.NODE_ENV !== "production") g.__redis = redis;

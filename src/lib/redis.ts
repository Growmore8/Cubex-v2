import Redis from "ioredis";

const g = globalThis as unknown as { __redis?: Redis };

export const redis: Redis = g.__redis ?? new Redis(process.env.REDIS_URL || "redis://localhost:6379");

if (process.env.NODE_ENV !== "production") g.__redis = redis;

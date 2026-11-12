import { PrismaClient } from "@prisma/client";

function makeClient() {
  // Explicit pool: 15 connections, 15s timeout.
  // Default (~5 conns, 10s timeout) causes login to hang when server.js
  // background tasks (monitor/checkPending at 3s intervals) hold the pool.
  const base = process.env.DATABASE_URL || "";
  const sep = base.includes("?") ? "&" : "?";
  const url = base + sep + "connection_limit=15&pool_timeout=15";
  return new PrismaClient({ log: ["error", "warn"], datasources: { db: { url } } });
}

type ExtPrisma = ReturnType<typeof makeClient>;
const globalForPrisma = globalThis as unknown as { prisma?: ExtPrisma };

export const prisma = globalForPrisma.prisma ?? makeClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
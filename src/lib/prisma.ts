import { PrismaClient } from "@prisma/client";

function makeClient() {
  return new PrismaClient({ log: ["error", "warn"] });
}

type ExtPrisma = ReturnType<typeof makeClient>;
const globalForPrisma = globalThis as unknown as { prisma?: ExtPrisma };

export const prisma = globalForPrisma.prisma ?? makeClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
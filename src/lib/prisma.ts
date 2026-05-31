import { PrismaClient } from "@prisma/client";
import { emitRefresh } from "@/lib/realtime";

const WRITES = new Set(["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]);
const MODELS = new Set(["Trade", "TradeHistory", "Account", "PaymentRequest", "KycDocument", "Notification"]);

function makeClient() {
  return new PrismaClient({ log: ["error", "warn"] }).$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }: any) {
          const res = await query(args);
          try { if (model && MODELS.has(model) && WRITES.has(operation)) emitRefresh({ model }); } catch (e) {}
          return res;
        },
      },
    },
  });
}

type ExtPrisma = ReturnType<typeof makeClient>;
const globalForPrisma = globalThis as unknown as { prisma?: ExtPrisma };

export const prisma = globalForPrisma.prisma ?? makeClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
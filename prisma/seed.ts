import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function ensureUser(data: {
  tenantId: string | null; email: string; name: string; passwordHash: string; role: any;
}) {
  const existing = await prisma.user.findFirst({ where: { tenantId: data.tenantId, email: data.email } });
  if (existing) return existing;
  return prisma.user.create({ data });
}

async function main() {
  const pw = await bcrypt.hash("Admin@12345", 10);

  await ensureUser({ tenantId: null, email: "superadmin@cubex.io", name: "Super Admin", passwordHash: pw, role: "SUPERADMIN" });

  let tenant = await prisma.tenant.findUnique({ where: { subdomain: "acme" } });
  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: {
        name: "Acme Markets", slug: "acme", subdomain: "acme",
        brandName: "Acme Markets", primaryColor: "#2563eb", accentColor: "#22c55e",
        subscription: { create: { plan: "PRO", status: "ACTIVE", seats: 50 } },
      },
    });
  }

  await ensureUser({ tenantId: tenant.id, email: "admin@acme.test", name: "Acme Admin", passwordHash: pw, role: "ADMIN" });
  await ensureUser({ tenantId: tenant.id, email: "client@acme.test", name: "Acme Client", passwordHash: pw, role: "CLIENT" });

  const symbols: [string, string][] = [["EURUSD", "EUR/USD"], ["GBPUSD", "GBP/USD"], ["XAUUSD", "Gold"]];
  for (const [s, d] of symbols) {
    const ex = await prisma.symbol.findFirst({ where: { tenantId: tenant.id, symbol: s } });
    if (!ex) await prisma.symbol.create({ data: { tenantId: tenant.id, symbol: s, display: d } });
  }

  console.log("Seed complete.");
  console.log("SuperAdmin : superadmin@cubex.io / Admin@12345  -> http://localhost:3000/login");
  console.log("Tenant Admin : admin@acme.test / Admin@12345    -> http://acme.localhost:3000/login");
  console.log("Tenant Client: client@acme.test / Admin@12345   -> http://acme.localhost:3000/login");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });

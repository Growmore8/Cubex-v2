import { PrismaClient } from "./node_modules/@prisma/client/index.js";
import bcrypt from "bcryptjs";
const prisma = new PrismaClient();

const acme = await prisma.tenant.findFirst({ where: { subdomain: "acme" } });
console.log("Tenant acme:", acme ? `${acme.name} (${acme.status}) id=${acme.id}` : "NOT FOUND");

const mgr = await prisma.user.findFirst({ where: { email: "manager@acme.test" } });
if (!mgr) {
  console.log("manager@acme.test NOT FOUND — creating...");
  const hash = await bcrypt.hash("Test@1234", 10);
  await prisma.user.create({ data: { tenantId: acme.id, email: "manager@acme.test", name: "Acme Manager", passwordHash: hash, role: "MANAGER", status: "ACTIVE", perms: {} } });
  console.log("Created manager@acme.test / Test@1234");
} else {
  console.log("Manager found:", { id: mgr.id, email: mgr.email, role: mgr.role, status: mgr.status, tenantId: mgr.tenantId, tenantMatches: mgr.tenantId === acme?.id });
  const ok = await bcrypt.compare("Test@1234", mgr.passwordHash);
  console.log("Password 'Test@1234' valid:", ok);
  if (!ok || mgr.status !== "ACTIVE" || mgr.tenantId !== acme?.id) {
    const hash = await bcrypt.hash("Test@1234", 10);
    await prisma.user.update({ where: { id: mgr.id }, data: { passwordHash: hash, status: "ACTIVE", tenantId: acme.id, role: "MANAGER" } });
    console.log("FIXED: reset password=Test@1234, status=ACTIVE, tenant=acme, role=MANAGER");
  }
}
await prisma.$disconnect();

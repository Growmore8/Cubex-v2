import { readFileSync } from "fs";
import { join } from "path";
import { PrismaClient } from "@prisma/client";

function loadEnv() {
  try {
    const env = readFileSync(join(process.cwd(), ".env"), "utf8");
    for (const line of env.split(/\r?\n/)) {
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)$/);
      if (m && process.env[m[1]] === undefined) {
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        process.env[m[1]] = v;
      }
    }
  } catch {}
}
loadEnv();

const prisma = new PrismaClient();

async function main() {
  const email = "client@acme.test";
  const tenant = await prisma.tenant.findFirst({ where: { slug: "acme" } });
  if (!tenant) throw new Error("Tenant acme not found - run the seed first.");
  const user = await prisma.user.findFirst({ where: { tenantId: tenant.id, email } });
  if (!user) throw new Error("User " + email + " not found.");

  const existing = await prisma.account.findFirst({ where: { userId: user.id } });
  if (existing) { console.log("Account already exists (login " + existing.login + "). Nothing to do."); return; }

  const accs = await prisma.account.findMany({ where: { tenantId: tenant.id }, select: { login: true } });
  let max = 1000;
  for (const a of accs) {
    const n = parseInt(a.login, 10);
    if (!isNaN(n) && String(n) === a.login && n > max) max = n;
  }
  const login = String(max + 1);

  const acc = await prisma.account.create({
    data: { tenantId: tenant.id, login, userId: user.id, name: user.name || "Test Client", type: "LIVE", leverage: 100, currency: "USD", deposit: 10000 },
  });
  console.log("Created LIVE account login " + acc.login + " for " + email + " funded with $10,000.");
}

main().then(() => prisma.$disconnect()).catch((e) => { console.error(e); prisma.$disconnect(); process.exit(1); });

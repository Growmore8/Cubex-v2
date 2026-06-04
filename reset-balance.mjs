import { PrismaClient } from "./node_modules/@prisma/client/index.js";
const prisma = new PrismaClient();
// Zero out the Acme test client (login 1001) balance components.
const acc = await prisma.account.findFirst({ where: { login: "1001" } });
if (acc) {
  await prisma.account.update({ where: { id: acc.id }, data: { deposit: 0, withdrawal: 0, credit: 0, bonus: 0, insurance: 0, pnl: 0 } });
  await prisma.financialHistory.deleteMany({ where: { accountId: acc.id } }).catch(() => {});
  console.log("Reset balance to 0 for", acc.login, acc.name);
} else {
  console.log("Account 1001 not found");
}
await prisma.$disconnect();

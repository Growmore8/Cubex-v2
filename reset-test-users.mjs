// Re-run any time to reset all test logins to Test@1234
import { PrismaClient } from './node_modules/@prisma/client/index.js';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const PASSWORD = 'Test@1234';
const hash = await bcrypt.hash(PASSWORD, 10);
const acme = await prisma.tenant.findFirst({ where: { subdomain: 'acme' } });

const sa = await prisma.user.findFirst({ where: { role: 'SUPERADMIN' } });
if (sa) await prisma.user.update({ where: { id: sa.id }, data: { passwordHash: hash } });

const admin = await prisma.user.findFirst({ where: { tenantId: acme.id, role: 'ADMIN' } });
if (admin) await prisma.user.update({ where: { id: admin.id }, data: { passwordHash: hash } });

let mgr = await prisma.user.findFirst({ where: { tenantId: acme.id, role: 'MANAGER' } });
if (!mgr) mgr = await prisma.user.create({ data: { tenantId: acme.id, email: 'manager@acme.test', name: 'Acme Manager', passwordHash: hash, role: 'MANAGER', status: 'ACTIVE', perms: {} } });
else await prisma.user.update({ where: { id: mgr.id }, data: { passwordHash: hash } });

const client = await prisma.user.findFirst({ where: { tenantId: acme.id, role: 'CLIENT' } });
if (client) await prisma.user.update({ where: { id: client.id }, data: { passwordHash: hash } });
const acc = client ? await prisma.account.findFirst({ where: { userId: client.id } }) : null;

console.log('All passwords reset to: ' + PASSWORD);
console.log('  SUPERADMIN: ' + (sa?.email) + '   @ http://localhost:3000/login');
console.log('  ADMIN     : ' + (admin?.email) + '   @ http://acme.localhost:3000/login');
console.log('  MANAGER   : ' + (mgr?.email) + ' @ http://acme.localhost:3000/login');
console.log('  CLIENT    : ' + (client?.email) + '  @ http://acme.localhost:3000/login  (Account ' + (acc?.login) + ')');
await prisma.$disconnect();

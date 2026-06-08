import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { effectiveSeatsForPlan } from "@/services/tenant.service";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireSuperAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const b = await req.json();
    const t: any = await prisma.tenant.findUnique({ where: { id } });
    if (!t) throw new Error("Tenant not found");

    if (b.action === "edit") {
      const data: any = {};
      if (b.name) data.name = b.name;
      if (b.brandName !== undefined) data.brandName = b.brandName || null;
      if (b.subdomain) data.subdomain = b.subdomain.toLowerCase();
      if (b.customDomain !== undefined) data.customDomain = b.customDomain || null;
      if (b.supportEmail !== undefined) data.supportEmail = b.supportEmail || null;
      if (b.slogan !== undefined) data.slogan = b.slogan || null;
      if (b.companyInfo !== undefined) data.companyInfo = b.companyInfo || null;
      if (b.contactName !== undefined) data.contactName = b.contactName || null;
      if (b.contactPhone !== undefined) data.contactPhone = b.contactPhone || null;
      if (b.logoUrl !== undefined) data.logoUrl = b.logoUrl || null;
      if (b.primaryColor) data.primaryColor = b.primaryColor;
      if (b.accentColor) data.accentColor = b.accentColor;
      if (b.smtpEmail !== undefined) data.smtpEmail = b.smtpEmail || null;
      if (b.smtpPassword !== undefined) data.smtpPassword = b.smtpPassword || null;
      if (b.smtpHost !== undefined) data.smtpHost = b.smtpHost || null;
      await prisma.tenant.update({ where: { id: t.id }, data });
      // Plan can also be changed here; seats follow the (live) package limit.
      if (b.plan) {
        const seats = await effectiveSeatsForPlan(prisma, b.plan);
        await prisma.subscription.upsert({
          where: { tenantId: t.id },
          create: { tenantId: t.id, plan: b.plan, status: "ACTIVE", seats },
          update: { plan: b.plan, seats },
        });
      }
    } else if (b.action === "perms") {
      await prisma.tenant.update({ where: { id: t.id }, data: { permissions: b.perms || {} } });
    } else if (b.action === "open" || b.action === "activate") {
      await prisma.tenant.update({ where: { id: t.id }, data: { status: "ACTIVE" as any } });
    } else if (b.action === "lock" || b.action === "suspend") {
      await prisma.tenant.update({ where: { id: t.id }, data: { status: "SUSPENDED" as any } });
    } else if (b.action === "resetPassword") {
      const admin = await prisma.user.findFirst({ where: { tenantId: t.id, role: "ADMIN" as any } });
      if (!admin) throw new Error("This tenant has no admin user");
      if (!b.password || b.password.length < 6) throw new Error("Password too short");
      await prisma.user.update({ where: { id: admin.id }, data: { passwordHash: await hashPassword(b.password) } });
    } else if (b.action === "updateSub") {
      const existing = await prisma.subscription.findUnique({ where: { tenantId: t.id } });
      const subData: any = {
        plan: b.plan,
        status: b.status,
        seats: b.seats !== undefined ? Number(b.seats) : undefined,
        endsAt: b.endsAt !== undefined ? (b.endsAt ? new Date(b.endsAt) : null) : undefined,
      };
      Object.keys(subData).forEach((k) => subData[k] === undefined && delete subData[k]);
      if (existing) {
        await prisma.subscription.update({ where: { tenantId: t.id }, data: subData });
      } else {
        await prisma.subscription.create({
          data: {
            tenantId: t.id,
            plan: b.plan || "STARTER",
            status: b.status || "ACTIVE",
            seats: b.seats ? Number(b.seats) : 5,
            endsAt: b.endsAt ? new Date(b.endsAt) : null,
          },
        });
      }
    } else if (b.action === "delete") {
      await prisma.tenant.delete({ where: { id: t.id } });
    } else {
      throw new Error("Unknown action");
    }

    await audit(t.id, "sa.tenant." + b.action, t.name, s.email);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}

import { NextResponse } from "next/server";
import { requireAdminOrManager, assertWritable } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { Prisma } from "@prisma/client";
import { assertCan } from "@/lib/perms";
import { notify } from "@/services/notification.service";
import { assertSeatAvailable } from "@/services/tenant.service";
import { applyClientEmail } from "@/services/account.service";
import { titleCaseName } from "@/lib/format";

const MANAGER_ALLOWED = ["status", "deactivate", "statusAll", "deactivateAll", "rename", "pool", "clearPin", "assign"];

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireAdminOrManager();
  if (!s) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    await assertWritable(s);
    const b = await req.json();
    const tenantId = s.tenantId as string;
    const acc = await prisma.account.findFirst({ where: { id, tenantId } });
    if (!acc) throw new Error("Account not found");
    if (s.role === "MANAGER" && !MANAGER_ALLOWED.includes(b.action)) {
      throw new Error("Not permitted for manager role");
    }
    const actor = s.email || "admin";
    const permMap: Record<string, string> = { manualPnl: "editFinancial", transfer: "transferFunds", subAccount: "createClients", reconcile: "editFinancial" };
    if (b.action === "settings" && b.spreadMarkup !== undefined) await assertCan(s, "editSpread");
    if (permMap[b.action]) await assertCan(s, permMap[b.action]);

    switch (b.action) {
      case "settings": {
        const data: any = {};
        if (b.leverage !== undefined) data.leverage = Number(b.leverage) || acc.leverage;
        if (b.mcLevel !== undefined) data.mcLevel = new Prisma.Decimal(Number(b.mcLevel) || 0);
        if (b.doNotLiquidate !== undefined) data.doNotLiquidate = !!b.doNotLiquidate;
        if (b.currency !== undefined) data.currency = b.currency;
        if (b.spreadMarkup !== undefined) data.spreadMarkup = new Prisma.Decimal(Math.max(0, Number(b.spreadMarkup) || 0));
        await prisma.account.update({ where: { id: acc.id }, data });
        await audit(tenantId, "client.settings", acc.login + " " + JSON.stringify(data), actor);
        break;
      }
      case "status": {
        await prisma.account.update({ where: { id: acc.id }, data: { locked: !!b.locked } });
        await audit(tenantId, "client.status", acc.login + (b.locked ? " locked" : " unlocked"), actor);
        break;
      }
      case "accountId": {
        const login = String(b.login || "").trim();
        if (!login) throw new Error("Account ID required");
        const clash = await prisma.account.findFirst({ where: { tenantId, login, NOT: { id: acc.id } } });
        if (clash) throw new Error("That account ID is already in use");
        await prisma.account.update({ where: { id: acc.id }, data: { login } });
        await audit(tenantId, "client.accountId", acc.login + " -> " + login, actor);
        break;
      }
      case "assignManager": {
        await prisma.account.update({ where: { id: acc.id }, data: { managerId: b.managerId || null } });
        await audit(tenantId, "client.assignManager", acc.login + " manager=" + (b.managerId || "none"), actor);
        break;
      }
      case "rename": {
        const name = titleCaseName(String(b.name || acc.name));
        const data: any = { name };
        if (b.phone !== undefined) data.phone = b.phone || null;
        if (b.country !== undefined) data.country = b.country || null;
        if (b.email !== undefined) {
          const newEmail = String(b.email || "").trim().toLowerCase();
          data.email = newEmail || null;
          if (acc.parentId && !newEmail) {
            // Clearing email on a sub-account → auto-unlink from parent
            data.parentId = null;
          } else if (!acc.parentId && newEmail) {
            // Setting email on a standalone account → try to re-link to matching user's primary account
            const matchUser = await prisma.user.findFirst({ where: { tenantId, email: newEmail } });
            if (matchUser && matchUser.id !== acc.userId) {
              const primary = await prisma.account.findFirst({ where: { tenantId, userId: matchUser.id, parentId: null, NOT: { id: acc.id } }, orderBy: { createdAt: "asc" } });
              if (primary) { data.parentId = primary.id; data.userId = matchUser.id; }
            }
          }
        }
        await prisma.account.update({ where: { id: acc.id }, data });
        // Email is the LOGIN identity — persist it to User.email (source of truth)
        // and repair an orphaned account if its login user was previously deleted.
        if (b.email !== undefined) await applyClientEmail(tenantId, acc.id, b.email);
        // Profile details are shared across ALL of a client's accounts (live + demo)
        // so an edit reflects everywhere — no matter which account (or which is the
        // oldest "parent") was edited, and regardless of live/demo type.
        if (acc.userId) {
          const shared: any = { name };
          if (b.phone !== undefined) shared.phone = b.phone || null;
          if (b.country !== undefined) shared.country = b.country || null;
          await prisma.account.updateMany({ where: { tenantId, userId: acc.userId, NOT: { id: acc.id } }, data: shared });
        }
        await audit(tenantId, "client.rename", acc.login + " -> " + name, actor);
        break;
      }
      case "manualPnl": {
        const amt = Number(b.amount);
        if (!amt) throw new Error("Amount required");
        await prisma.account.update({ where: { id: acc.id }, data: { pnl: { increment: new Prisma.Decimal(amt) } } });
        // Record in financial history (signed) so it shows in the client + desk History.
        await prisma.financialHistory.create({ data: { accountId: acc.id, type: "PNL_ADJUST" as any, amount: new Prisma.Decimal(amt), description: b.description || "Manual P/L adjustment", mode: "MANUAL" as any, createdBy: actor } }).catch(() => {});
        await audit(tenantId, "client.manualPnl", acc.login + " " + amt, actor);
        break;
      }
      case "reconcile": {
        // Recompute the account's realized P/L from the surviving records:
        // sum of closed-trade P/L + sum of manual P/L (PNL_ADJUST) rows. This
        // removes orphaned amounts left when a manual P/L was deleted on a build
        // that didn't reverse the balance. Deposits/credit/bonus are untouched.
        const [tAgg, fins] = await Promise.all([
          prisma.tradeHistory.aggregate({ where: { accountId: acc.id }, _sum: { pnl: true } }),
          prisma.financialHistory.findMany({ where: { accountId: acc.id, type: "PNL_ADJUST" as any }, select: { amount: true } }),
        ]);
        const tradePnl = Number(tAgg._sum.pnl || 0);
        const manualPnl = fins.reduce((sum, f) => sum + Number(f.amount), 0);
        const after = tradePnl + manualPnl;
        const before = Number(acc.pnl);
        await prisma.account.update({ where: { id: acc.id }, data: { pnl: new Prisma.Decimal(after) } });
        await audit(tenantId, "client.reconcile", `${acc.login} pnl ${before} -> ${after} (trades ${tradePnl} + manual ${manualPnl})`, actor);
        return NextResponse.json({ ok: true, before, after, delta: after - before });
      }
      case "transfer": {
        const amt = Number(b.amount);
        if (!amt || amt <= 0) throw new Error("Amount must be positive");
        const dest = await prisma.account.findFirst({ where: { tenantId, login: String(b.toLogin || "").trim() } });
        if (!dest) throw new Error("Destination account not found");
        if (dest.id === acc.id) throw new Error("Cannot transfer to the same account");
        const ref = "TRF-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
        await prisma.$transaction([
          prisma.account.update({ where: { id: acc.id }, data: { withdrawal: { increment: new Prisma.Decimal(amt) } } }),
          prisma.account.update({ where: { id: dest.id }, data: { deposit: { increment: new Prisma.Decimal(amt) } } }),
          prisma.financialHistory.create({ data: { accountId: acc.id, type: "TRANSFER_OUT" as any, amount: new Prisma.Decimal(amt), description: "Transfer to " + dest.login, reference: ref, mode: "MANUAL", createdBy: actor } }),
          prisma.financialHistory.create({ data: { accountId: dest.id, type: "TRANSFER_IN" as any, amount: new Prisma.Decimal(amt), description: "Transfer from " + acc.login, reference: ref, mode: "MANUAL", createdBy: actor } }),
        ]);
        await audit(tenantId, "client.transfer", acc.login + " -> " + dest.login + " " + amt, actor);
        // Notify both clients of the funds movement (transfer is a fund event)
        try {
          if (acc.userId) await notify(tenantId, acc.userId, "Transfer out", `-${amt} transferred to ${dest.login}`, "FUNDS");
          if (dest.userId) await notify(tenantId, dest.userId, "Transfer in", `+${amt} received from ${acc.login}`, "FUNDS");
        } catch {}
        break;
      }
      case "subAccount": {
        const subType0 = b.type === "DEMO" ? "DEMO" : (b.type === "LIVE" ? "LIVE" : acc.type);
        await assertSeatAvailable(prisma, tenantId, subType0); // enforce the plan's account limit (live only)
        const accs = await prisma.account.findMany({ where: { tenantId }, select: { login: true } });
        let max = 900000;
        for (const a of accs) { const n = parseInt(a.login, 10); if (!isNaN(n) && String(n) === a.login && n > max) max = n; }
        const login = String(max + 1);
        const subType = b.type === "DEMO" ? "DEMO" : (b.type === "LIVE" ? "LIVE" : acc.type);
        const subDep = Number(b.deposit) > 0 ? new Prisma.Decimal(Number(b.deposit)) : new Prisma.Decimal(0);
        const sub = await prisma.account.create({ data: { tenantId, login, name: b.name || (acc.name + " sub"), type: subType, leverage: Number(b.leverage) || acc.leverage, currency: b.currency || acc.currency, managerId: acc.managerId, groupId: acc.groupId, parentId: acc.id, userId: acc.userId, mcLevel: new Prisma.Decimal(50), deposit: subDep } });
        if (Number(b.deposit) > 0) await prisma.financialHistory.create({ data: { accountId: sub.id, type: "DEPOSIT" as any, amount: subDep, description: "Initial deposit", mode: "MANUAL", createdBy: actor } });
        await audit(tenantId, "client.subAccount", "parent " + acc.login + " -> " + login, actor);
        break;
      }
      case "assignGroup": {
        await prisma.account.update({ where: { id: acc.id }, data: { groupId: b.groupId || null } });
        await audit(tenantId, "client.assignGroup", acc.login + " group=" + (b.groupId || "none"), actor);
        break;
      }
      case "unlinkSub": {
        // Detach a sub-account from its parent so it stands alone (no longer
        // grouped under the parent in the client's linked-accounts list).
        if (!acc.parentId) throw new Error("This account is not a sub-account");
        await prisma.account.update({ where: { id: acc.id }, data: { parentId: null } });
        await audit(tenantId, "client.unlinkSub", acc.login + " detached from parent", actor);
        break;
      }
      case "assign": {
        // Combined manager + group assignment. Group must belong to the chosen
        // manager (or be an admin-level group when no manager is chosen).
        const managerId = b.managerId || null;
        let groupId = b.groupId || null;
        if (groupId) {
          const g = await prisma.tradeGroup.findFirst({ where: { id: groupId, tenantId } });
          if (!g) throw new Error("Group not found");
          if ((g.managerId || null) !== managerId) throw new Error("That group does not belong to the selected manager");
        }
        // a manager can only (re)assign within their own clients
        if (s.role === "MANAGER" && (acc.managerId || null) !== s.sub) throw new Error("Not your client");
        await prisma.account.update({ where: { id: acc.id }, data: { managerId, groupId } });
        await audit(tenantId, "client.assign", acc.login + " manager=" + (managerId || "admin") + " group=" + (groupId || "none"), actor);
        break;
      }
      case "clearPin": {
        if (acc.userId) await prisma.user.update({ where: { id: acc.userId }, data: { pinHash: null } });
        await audit(tenantId, "client.clearPin", acc.login, actor);
        break;
      }
      case "deactivate": {
        await prisma.account.update({ where: { id: acc.id }, data: { deactivated: !!b.deactivated } });
        await audit(tenantId, "client.deactivate", acc.login + (b.deactivated ? " deactivated" : " activated"), actor);
        break;
      }
      case "statusAll": {
        if (!acc.userId) throw new Error("Account not linked to a user");
        await prisma.account.updateMany({ where: { tenantId, userId: acc.userId }, data: { locked: !!b.locked } });
        await audit(tenantId, "client.statusAll", "userId:" + acc.userId + (b.locked ? " all locked" : " all unlocked"), actor);
        break;
      }
      case "deactivateAll": {
        if (!acc.userId) throw new Error("Account not linked to a user");
        await prisma.account.updateMany({ where: { tenantId, userId: acc.userId }, data: { deactivated: !!b.deactivated } });
        await audit(tenantId, "client.deactivateAll", "userId:" + acc.userId + (b.deactivated ? " all deactivated" : " all activated"), actor);
        break;
      }
      case "pool": {
        await prisma.account.update({ where: { id: acc.id }, data: { isPool: !!b.promote } });
        await audit(tenantId, "client.pool", acc.login + (b.promote ? " promoted to pool" : " demoted from pool"), actor);
        break;
      }
      default:
        throw new Error("Unknown action");
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Failed" }, { status: 400 });
  }
}
import { prisma } from "./prisma";

async function getSaConfig() {
  const rec = await prisma.setting.findUnique({ where: { key: "sa_config" } }).catch(() => null);
  return (rec?.value as any) || {};
}

async function getTenantSms(tenantId: string) {
  const rec = await prisma.setting.findUnique({ where: { key: `sms:${tenantId}` } }).catch(() => null);
  const v = (rec?.value as any) || {};
  return { enabled: !!v.enabled, phones: Array.isArray(v.phones) ? (v.phones as string[]) : [] };
}

async function getTenantName(tenantId: string): Promise<string> {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }).catch(() => null);
  return t?.name || "OrbitFX";
}

// Send an SMS to all configured admin numbers for a tenant via Notify.lk.
// Silently no-ops if credentials are missing or SMS is disabled for the tenant.
export async function sendTenantSms(tenantId: string, message: string) {
  try {
    const [cfg, tenantSms, brandName] = await Promise.all([getSaConfig(), getTenantSms(tenantId), getTenantName(tenantId)]);
    if (!cfg.notifyLkUserId || !cfg.notifyLkApiKey) return;
    if (!tenantSms.enabled || !tenantSms.phones.length) return;
    const senderId = (cfg.notifyLkServiceId as string || "").trim();
    const text = (`[${brandName}] ` + message).slice(0, 160);
    await Promise.allSettled(
      tenantSms.phones.map((phone: string) => {
        const body = new URLSearchParams({
          user_id: String(cfg.notifyLkUserId),
          api_key: String(cfg.notifyLkApiKey),
          to: phone.replace(/^\+/, ""),
          message: text,
        });
        if (senderId) body.set("sender_id", senderId);
        return fetch("https://app.notify.lk/api/v1/send", { method: "POST", body });
      })
    );
  } catch {}
}

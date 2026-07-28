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

// Send an SMS to all configured admin numbers for a tenant via Notify.lk.
// Silently no-ops if credentials are missing or SMS is disabled for the tenant.
export async function sendTenantSms(tenantId: string, message: string) {
  try {
    const [cfg, tenant] = await Promise.all([getSaConfig(), getTenantSms(tenantId)]);
    if (!cfg.notifyLkUserId || !cfg.notifyLkApiKey) return;
    if (!tenant.enabled || !tenant.phones.length) return;
    const serviceId = (cfg.notifyLkServiceId as string) || "NotifyDEMO";
    const text = message.slice(0, 160);
    await Promise.allSettled(
      tenant.phones.map((phone: string) => {
        const params = new URLSearchParams({
          user_id: String(cfg.notifyLkUserId),
          api_key: String(cfg.notifyLkApiKey),
          service_id: serviceId,
          to: phone,
          message: text,
        });
        return fetch("https://app.notify.lk/api/v1/send?" + params.toString());
      })
    );
  } catch {}
}

const webpush: any = require("web-push");
import { prisma } from "@/lib/prisma";

let configured = false;
function ensure(): boolean {
  if (configured) return true;
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@cubex.io", pub, priv);
  configured = true;
  return true;
}

export async function sendPushToUser(userId: string, payload: { title: string; body?: string | null; url?: string }) {
  if (!ensure()) return;
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  const data = JSON.stringify({ title: payload.title, body: payload.body || "", url: payload.url || "/client" });
  for (const sub of subs) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, data);
    } catch (e: any) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) {
        await prisma.pushSubscription.delete({ where: { endpoint: sub.endpoint } }).catch(() => {});
      }
    }
  }
}
import crypto from "crypto";

const WIDGET_BASE = "https://buy.moonpay.com";

// Map wallet network labels to MoonPay currency codes
const NETWORK_TO_CODE: Record<string, string> = {
  TRC20: "usdt_trc20",
  ERC20: "usdt_erc20",
  BEP20: "usdt_bep20",
};

export function networkToCurrencyCode(network: string): string {
  return NETWORK_TO_CODE[network.toUpperCase()] ?? "usdt_trc20";
}

export function getMoonPayUrl(params: {
  walletAddress: string;
  currencyCode: string;
  externalTransactionId: string;
  baseCurrencyAmount?: number;
  email?: string;
}): string {
  const pk = process.env.MOONPAY_PK ?? "";
  const sk = process.env.MOONPAY_SK ?? "";
  if (!pk || !sk) throw new Error("MoonPay not configured");

  const q = new URLSearchParams({
    apiKey: pk,
    currencyCode: params.currencyCode,
    walletAddress: params.walletAddress,
    externalTransactionId: params.externalTransactionId,
  });
  if (params.baseCurrencyAmount && params.baseCurrencyAmount > 0)
    q.set("baseCurrencyAmount", String(params.baseCurrencyAmount));
  if (params.email) q.set("email", params.email);

  const queryString = "?" + q.toString();
  const signature = crypto.createHmac("sha256", sk).update(queryString).digest("base64");
  q.set("signature", signature);
  return `${WIDGET_BASE}?${q.toString()}`;
}

// MoonPay webhook signature: header is "t=<timestamp>,s=<hex-hmac>"
export function verifyMoonPayWebhook(rawBody: string, signatureHeader: string): boolean {
  const sk = process.env.MOONPAY_SK ?? "";
  if (!sk) return false;
  try {
    const parts = Object.fromEntries(signatureHeader.split(",").map((p) => p.split("=")));
    const timestamp = parts["t"];
    const signature = parts["s"];
    if (!timestamp || !signature) return false;
    const payload = timestamp + "." + rawBody;
    const expected = crypto.createHmac("sha256", sk).update(payload).digest("hex");
    const expectedBuf = Buffer.from(expected, "hex");
    const receivedBuf = Buffer.from(signature, "hex");
    if (expectedBuf.length !== receivedBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, receivedBuf);
  } catch {
    return false;
  }
}

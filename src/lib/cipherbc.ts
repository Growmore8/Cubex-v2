import crypto from "crypto";

function decodePem(envVar: string | undefined): string | null {
  if (!envVar) return null;
  if (envVar.startsWith("-----")) return envVar;
  try {
    return Buffer.from(envVar, "base64").toString("utf-8").trim();
  } catch {
    return null;
  }
}

/** Their business public key — used to verify deposit & withdrawal webhook signatures */
export function getCipherbcBusinessPublicKey() {
  return decodePem(process.env.CIPHERBC_BUSINESS_PUBLIC_KEY_B64);
}

/** Their risk public key — used to verify risk-control webhook signatures */
export function getCipherbcRiskPublicKey() {
  return decodePem(process.env.CIPHERBC_RISK_PUBLIC_KEY_B64);
}

/** Our business private key — used to sign outbound payment requests */
export function getBusinessPrivateKey() {
  return decodePem(process.env.CIPHERBC_BUSINESS_PRIVATE_KEY_B64);
}

/** Our risk private key — used to sign risk-control responses */
export function getRiskPrivateKey() {
  return decodePem(process.env.CIPHERBC_RISK_PRIVATE_KEY_B64);
}

function rsaVerify(pubKey: string, data: string, signature: string): boolean {
  try {
    // CipherBC uses MD5withRSA (RSA-MD5) for all signing
    return crypto.createVerify("MD5").update(data, "utf-8").verify(pubKey, signature, "base64");
  } catch {
    return false;
  }
}

/** Verify deposit / withdrawal callback signature using CipherBC's business public key */
export function verifyCipherbcSignature(body: string, signature: string): boolean {
  const key = getCipherbcBusinessPublicKey();
  return !!key && rsaVerify(key, body, signature);
}

/** Verify risk-control callback signature using CipherBC's risk public key */
export function verifyCipherbcRiskSignature(body: string, signature: string): boolean {
  const key = getCipherbcRiskPublicKey();
  return !!key && rsaVerify(key, body, signature);
}

/** Sign data with our business private key (for outbound deposit/withdrawal requests) */
export function signWithBusinessKey(data: string): string {
  const privKey = getBusinessPrivateKey();
  if (!privKey) throw new Error("CIPHERBC_BUSINESS_PRIVATE_KEY_B64 not set");
  // CipherBC uses MD5withRSA
  return crypto.createSign("MD5").update(data, "utf-8").sign(privKey, "base64");
}

/** Sign data with our risk private key (for risk-control responses) */
export function signWithRiskKey(data: string): string {
  const privKey = getRiskPrivateKey();
  if (!privKey) throw new Error("CIPHERBC_RISK_PRIVATE_KEY_B64 not set");
  return crypto.createSign("MD5").update(data, "utf-8").sign(privKey, "base64");
}

// Shared builder/validator for deposit payment methods (CryptoWallet rows).
// Used by both the SuperAdmin and tenant-admin payment-method routes so the two
// stay in lock-step. Supports CRYPTO | UPI | LINK | BANK.

export type WalletData = {
  type: string;
  network: string;
  asset: string;
  address: string;
  label: string | null;
  url: string | null;
  details: any;
  active: boolean;
};

// Build the CryptoWallet `data` payload from a request body.
// Pass addedBy to tag the row so SA-configured and tenant-managed methods stay separate.
export function buildWalletData(b: any, addedBy?: "sa" | "tenant"): WalletData {
  const type = String(b.type || "CRYPTO").toUpperCase();
  if (type === "BANK") {
    const bank = b.bank || {};
    const accountNumber = String(bank.accountNumber || "").trim();
    const accountName = String(bank.accountName || "").trim();
    const bankName = String(bank.bankName || "").trim();
    const ifsc = String(bank.ifsc || "").trim().toUpperCase();
    return {
      type,
      network: "",
      asset: "BANK",
      address: accountNumber, // so list rows have something to show
      label: bankName || b.label || null,
      url: null,
      details: { accountNumber, accountName, bankName, ifsc, ...(addedBy ? { _addedBy: addedBy } : {}) },
      active: b.active !== false,
    };
  }
  return {
    type,
    network: type === "CRYPTO" ? (b.network || "BEP20") : "",
    asset: b.asset || "USDT",
    address: b.address || "",
    label: b.label || null,
    url: b.url || null,
    details: addedBy ? { _addedBy: addedBy } : null,
    active: b.active !== false,
  };
}

// Read the _addedBy tag from a wallet row's details.
// Rows created before this feature have no tag → treated as "tenant" (backward compat).
export function walletAddedBy(w: { details: any }): "sa" | "tenant" {
  return (w.details as any)?._addedBy === "sa" ? "sa" : "tenant";
}

// Throw if the built data is missing required fields for its type.
export function assertWalletValid(data: WalletData): void {
  if (data.type === "CRYPTO" && !data.address) throw new Error("Address required");
  if (data.type === "UPI" && !data.address) throw new Error("UPI id required");
  if (data.type === "LINK" && !data.url) throw new Error("Link URL required");
  if (data.type === "BANK") {
    const d = data.details || {};
    if (!d.accountNumber || !d.accountName || !d.bankName) throw new Error("Account number, account name and bank name are required");
  }
}

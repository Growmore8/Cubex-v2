export const PACKAGES = {
  STARTER: {
    plan: "STARTER" as const,
    name: "Starter",
    price: 999,
    seats: 5,
    color: "#2563eb",
    description: "For small teams getting started",
    features: [
      "Up to 5 Trading Accounts",
      "Live & Demo Accounts",
      "Basic Trade Desk",
      "Email Support",
      "Standard Reports",
      "KYC Management",
    ],
  },
  PRO: {
    plan: "PRO" as const,
    name: "Pro",
    price: 1999,
    seats: 25,
    color: "#7c3aed",
    description: "For growing brokerages",
    features: [
      "Up to 25 Trading Accounts",
      "All Starter Features",
      "Manager Role Access",
      "Priority Support",
      "Advanced Reports",
      "Custom Branding",
      "API Access",
      "Group Management",
    ],
  },
  ENTERPRISE: {
    plan: "ENTERPRISE" as const,
    name: "Enterprise",
    price: 2999,
    seats: 100,
    color: "#d97706",
    description: "For large organizations",
    features: [
      "Up to 100 Trading Accounts",
      "All Pro Features",
      "Dedicated Account Manager",
      "White Label Solution",
      "Custom Integrations",
      "SLA Guarantee",
      "Multi-admin Access",
      "Audit Compliance Tools",
    ],
  },
} as const;

export type PlanKey = keyof typeof PACKAGES;
export const PLAN_KEYS: PlanKey[] = ["STARTER", "PRO", "ENTERPRISE"];

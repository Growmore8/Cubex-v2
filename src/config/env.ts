function req(key: string, fallback?: string) {
  const v = process.env[key] ?? fallback;
  if (v === undefined) throw new Error(`Missing env: ${key}`);
  return v;
}

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? "development",
  APP_NAME: process.env.APP_NAME ?? "Cubex",
  ROOT_DOMAIN: req("ROOT_DOMAIN", "localhost:3000"),
  DATABASE_URL: req("DATABASE_URL"),
  JWT_SECRET: req("JWT_SECRET"),
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN ?? "8h",
  REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
  MAIL_FROM: process.env.MAIL_FROM ?? "Cubex <no-reply@cubex.io>",
  SMTP_HOST: process.env.SMTP_HOST ?? "",
  SMTP_PORT: Number(process.env.SMTP_PORT ?? 587),
  SMTP_USER: process.env.SMTP_USER ?? "",
  SMTP_PASS: process.env.SMTP_PASS ?? "",
};

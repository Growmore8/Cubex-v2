# White-label custom domains (Plan B)

Every broker (tenant) runs on **their own domain** — their traders never see CubeX or your domain.

## How it works
- **Caddy** is the reverse proxy and issues TLS **on-demand**: when a request arrives for a
  hostname it doesn't have a cert for, it asks the app (`/api/internal/tls-check?domain=…`)
  whether that host is a real tenant; if approved, it obtains a Let's Encrypt cert for that
  exact domain on the spot and caches it. Random domains pointed at the server are refused
  (no cert), so there's no abuse.
- The app reads the request host and `resolveTenant()` matches it against each tenant's
  **Custom Domain** (or subdomain). Branding + login isolation follow automatically.
- The reserved tool hosts `db.<your-domain>` (Adminer) and `files.<your-domain>` (Filebrowser)
  have their own blocks in the `Caddyfile`.

## Onboarding a broker — checklist

### You (platform / super admin)
1. Super Admin → **Tenants → New Tenant**: set subdomain, brand name, **logo**, slogan, footer, colors,
   and the tenant-admin email/password.
2. Super Admin → **Edit Tenant → Custom Domain** = the broker's domain, e.g. `trade.acmemarkets.com`
   (lowercase, no `https://`, no trailing slash).
3. Send the broker their login URL + admin credentials.

### Broker (one DNS record on their domain)
Add ONE record at their registrar pointing the subdomain to this server:

```
trade   A   93.127.194.59
# or:  trade  CNAME  <your-platform-domain>
```
Use a **subdomain** (e.g. `trade.`), not the bare apex domain (apex can't CNAME on most registrars).
Wait ~1–10 min for DNS; HTTPS is issued automatically on the first visit.

### Traders
Go to `https://trade.acmemarkets.com/register` (or `/login`). 100% the broker's brand.

## Notes
- **First visit to a brand-new domain** takes a few seconds while Caddy issues the cert; instant
  afterwards. The cert is cached in the `caddy-data` Docker volume — **don't delete that volume**
  or you'll re-issue all certs (and can hit Let's Encrypt rate limits).
- **Required `.env` values:**
  - `DOMAIN=<your platform domain>` (e.g. `cubexenterprises.com`) — used by Caddy for `db.`/`files.`
    and by the cert-check fallback.
  - `ROOT_DOMAIN=<your platform domain>` — so the app tells your root + subdomains apart from
    tenant custom domains (used by `resolveTenant` and `/api/internal/tls-check`).
  - `ACME_EMAIL=<your email>` — Let's Encrypt account email.
- **Abuse protection is built in:** Caddy only issues a cert after `/api/internal/tls-check` approves
  the host (the platform domain, its subdomains, or a tenant's saved custom domain). Unknown domains
  pointed at the server get no cert.
- A tenant's custom domain must exist **in the production database** before its cert can be issued —
  create/edit the tenant on the live Super Admin, not just locally.
- **Email white-label** (sender address / links in KYC + notification emails) is a separate piece —
  currently global. Ask if you use email and want per-tenant senders.

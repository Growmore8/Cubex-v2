# White-label custom domains (Plan B)

Every broker (tenant) runs on **their own domain** — their traders never see CubeX or your domain.

## How it works
- Traefik runs a **catch-all router** (`HostRegexp(`.+`)`) and auto-issues a Let's Encrypt
  certificate for whatever hostname arrives (on first hit), as long as that domain's DNS
  points at this server.
- The app reads the request host and `resolveTenant()` matches it against each tenant's
  **Custom Domain** (or subdomain). Branding + login isolation follow automatically.
- The reserved tool hosts `db.<your-domain>` (Adminer) and `files.<your-domain>` (Filebrowser)
  win over the catch-all via higher router priority.

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
- **First visit to a brand-new domain** may take a few seconds (cert issuance) or briefly warn until
  the cert lands; instant afterwards.
- Set **`ROOT_DOMAIN=<your platform domain>`** in `.env` so the app tells your root apart from
  custom domains.
- **Abuse note:** the catch-all serves any domain pointed at the server; only domains that resolve
  here and pass the HTTP-01 challenge get a cert, so random domains can't get certs. If you want to
  hard-restrict to configured tenant domains only, that needs a Traefik middleware/plugin — ask and
  I'll add it.
- **Email white-label** (sender address / links in KYC + notification emails) is a separate piece —
  currently global. Ask if you use email and want per-tenant senders.

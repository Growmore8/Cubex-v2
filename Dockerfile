# CubeX V2 — production image for the custom Next.js + Socket.IO server (server.js)
# Build:  docker compose up -d --build
FROM node:20-bookworm-slim AS base
# openssl + ca-certificates are required by Prisma's query engine
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ---- dependencies ----
FROM base AS deps
COPY package.json package-lock.json .npmrc ./
COPY prisma ./prisma
RUN npm ci

# ---- build (prisma generate + next build) ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- runtime ----
FROM base AS run
ENV NODE_ENV=production
ENV PORT=3000
# the custom server needs the full app (it loads next() against .next)
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/server.js ./server.js
COPY --from=build /app/next.config.js ./next.config.js
COPY --from=build /app/package.json ./package.json
# seed/utility scripts (used once after first deploy)
COPY --from=build /app/seed-symbols.mjs ./seed-symbols.mjs
RUN mkdir -p /app/uploads
EXPOSE 3000
# Sync the DB schema to match prisma/schema.prisma on every start (additive `db push`,
# no migration files needed), then launch the server. This keeps production columns
# (customDomain, supportEmail, slogan, …) in sync so the white-label features work.
# --accept-data-loss is required for index/constraint swaps (e.g. relaxing a unique
# key); without it db push aborts and the container crash-loops into a 502.
CMD ["sh", "-c", "npx prisma db push --skip-generate --accept-data-loss && node server.js"]

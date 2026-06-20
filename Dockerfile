FROM node:20-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM base AS builder
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p public
RUN npx prisma generate
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs
RUN mkdir -p public

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules ./node_modules

# Next's standalone server reads HOSTNAME from the environment by default.
# Force the bind address so Docker's own HOSTNAME variable cannot hijack it.
RUN node -e "const fs = require('fs'); const p = '/app/server.js'; const old = \"const hostname = process.env.HOSTNAME || '0.0.0.0'\"; const next = \"const hostname = '0.0.0.0'\"; const s = fs.readFileSync(p, 'utf8'); if (!s.includes(old)) throw new Error('server.js pattern not found'); fs.writeFileSync(p, s.replace(old, next));"

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]

# syntax=docker/dockerfile:1

# ── Build stage ───────────────────────────────────────────────────────────────
# Install ALL deps (incl. dev) and compile TypeScript → dist/.
FROM node:22-slim AS build
WORKDIR /app

# Copy manifests first for better layer caching: deps only re-install when they change.
COPY package.json package-lock.json ./
RUN npm ci

# Copy the sources needed to compile and build.
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── Runtime stage ─────────────────────────────────────────────────────────────
# Slim Node base, production deps only, non-root, compiled JS.
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Install production dependencies only.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy the compiled output. Templates are inlined as TS strings at build time
# (compiled into dist/), so the legacy templates/ dir is NOT shipped.
COPY --from=build /app/dist ./dist

# Sensible defaults. HOST=0.0.0.0 so the container is reachable from the host
# publish mapping (compose publishes it as 127.0.0.1:PORT:PORT to stay proxy-only).
ENV PORT=3000 \
    HOST=0.0.0.0 \
    OUTPOST_DOMAINS_DIR=/domains \
    OUTPOST_DEFAULT_DOMAIN=default \
    OUTPOST_INDEX_FILENAME=index \
    OUTPOST_DEFAULT_TYPE=text/html \
    TRUST_FORWARDED_HEADERS=on

EXPOSE 3000

# Run as the unprivileged `node` user that ships with the base image.
USER node

# Health check hits /healthz (plain-text "ok"). Uses Node's global fetch — no
# curl/wget needed in the slim base.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>r.text()).then(t=>process.exit(t.trim()==='ok'?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]

# syntax=docker/dockerfile:1

# ── Build stage ───────────────────────────────────────────────────────────────
# Install ALL deps (incl. dev) and compile TypeScript → dist/.
FROM node:24-slim AS build
WORKDIR /app

# pnpm is provisioned by corepack, pinned via the "packageManager" field in
# package.json. COREPACK_ENABLE_DOWNLOAD_PROMPT=0 keeps the build non-interactive.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

# Copy manifests first for better layer caching: deps only re-install when they change.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy the sources needed to compile and build.
COPY tsconfig.json ./
COPY src ./src
RUN pnpm run build

# ── Runtime stage ─────────────────────────────────────────────────────────────
# Slim Node base, production deps only, non-root, compiled JS.
FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

# Install production dependencies only. --ignore-scripts skips lifecycle hooks
# (notably the `prepare` → husky dev-tooling step), which aren't installed under
# --prod and would otherwise fail the build; the prod deps need no build scripts.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile --ignore-scripts && pnpm store prune

# Copy the compiled output. Only the emergency fallback templates are embedded
# as strings in dist/; the real, styled page templates ship as .eta files inside
# domains.example (copied below), not compiled into the binary.
COPY --from=build /app/dist ./dist

# The shipped example default — the final root in the runtime cascade. It is the
# fallback the app serves (welcome page + _templates/*.eta) when no local domain
# folder answers a request; the domains root itself is created empty, not seeded.
# Resolved by the app relative to dist/, one level up.
COPY domains.example ./domains.example

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

# Create the domains root and hand it to the `node` user. A bind mount usually
# covers this path at runtime, but pre-creating it (owned by node) lets the
# container also start bare: the app's first-run mkdir would otherwise fail as
# non-root trying to create a directory at the filesystem root.
RUN mkdir -p /domains && chown node:node /domains

# Run as the unprivileged `node` user that ships with the base image.
USER node

# Health check hits /healthz (plain-text "ok"). Uses Node's global fetch — no
# curl/wget needed in the slim base.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>r.text()).then(t=>process.exit(t.trim()==='ok'?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]

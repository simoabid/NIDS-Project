# ─────────────────────────────────────────────────────────────────────────────
# NIDS Backend — Dockerfile
# Multi-stage build:
#   Stage 1 (builder)    — install all deps, compile TypeScript → dist/
#   Stage 2 (production) — copy compiled output + prod deps only, run as non-root
#
# Build:  docker build -t nids-backend .
# Run:    docker run --env-file .env -p 5000:5000 nids-backend
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: Builder ──────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

# Install build tools needed by some native addons (e.g. bcrypt)
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy manifests first — Docker caches this layer and skips npm ci on
# subsequent builds if package*.json and tsconfig haven't changed.
COPY package*.json ./
COPY tsconfig.json ./

# Install ALL dependencies (including devDependencies for TypeScript)
RUN npm ci

# Copy source — separate layer from node_modules so source changes don't
# invalidate the npm ci cache.
COPY src/ ./src/

# Compile TypeScript → dist/
# Fails the build immediately if there are type errors (good — CI gate).
RUN npm run build

# ── Stage 2: Production ───────────────────────────────────────────────────────
FROM node:22-alpine AS production

# ── Install Suricata — needed by captureService.ts for live network capture ──
# Suricata is in Alpine's community repo. We also need libcap for cap_net_raw.
RUN echo "https://dl-cdn.alpinelinux.org/alpine/edge/community" >> /etc/apk/repositories \
 && apk add --no-cache suricata libcap

# ── Security: create a non-root user ─────────────────────────────────────────
# Running as root inside a container is a security risk. A dedicated system
# user limits the blast radius if the process is ever compromised.
RUN addgroup -g 1001 -S nodejs \
 && adduser  -u 1001 -S nids -G nodejs

WORKDIR /app

# Copy manifests so we can install only production dependencies
COPY package*.json ./

# --omit=dev drops ~200 MB of TypeScript tooling from the final image.
# npm cache clean prevents the npm cache from bloating the layer.
RUN npm ci --omit=dev \
 && npm cache clean --force

# Copy compiled JavaScript from the builder stage
COPY --from=builder /app/dist ./dist

# Transfer ownership of the working directory to our non-root user
RUN chown -R nids:nodejs /app

# Give the node binary network capture capabilities so the non-root user
# can open network interfaces for Suricata's packet capture.
# Note: We keep USER nids for normal operation; Suricata itself is spawned
# with the right capabilities via setcap.
RUN setcap 'cap_net_raw,cap_net_admin=eip' /usr/bin/suricata || true

# Drop to non-root
USER nids

# ── Runtime configuration ─────────────────────────────────────────────────────
ENV NODE_ENV=production
ENV PORT=5000

# Document the port — does NOT publish it; that's docker-compose / -p flag
EXPOSE 5000

# ── Health check ──────────────────────────────────────────────────────────────
# Docker and docker-compose use this to decide when the container is healthy.
# Matches the /api/health endpoint in app.ts.
# wget is used instead of curl — it's available in alpine out of the box.
HEALTHCHECK \
  --interval=30s \
  --timeout=5s  \
  --start-period=25s \
  --retries=3 \
  CMD wget -qO- http://localhost:5000/api/health || exit 1

# ── Entrypoint ────────────────────────────────────────────────────────────────
# Use exec form (JSON array) — ensures the Node process receives OS signals
# (SIGTERM/SIGINT) directly rather than via a shell wrapper, which is what
# makes our graceful shutdown handler in index.ts actually fire.
CMD ["node", "dist/index.js"]

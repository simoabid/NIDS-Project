# ─────────────────────────────────────────────────────────────────────────────
# Frontend — Multi-stage Dockerfile
# Stage 1: Build the Vite/React SPA
# Stage 2: Serve static files with a lightweight Node server
#
# VITE_ vars must be available at BUILD TIME — Vite bakes them into the JS.
# The runtime `environment:` block in docker-compose has no effect on a
# pre-built static SPA; use `build.args:` instead.
# ─────────────────────────────────────────────────────────────────────────────

FROM node:22-alpine AS build

WORKDIR /app

# Copy package files for layer caching
COPY package.json package-lock.json ./
RUN npm ci

# ── Build-time env vars ──────────────────────────────────────────────────────
# Vite replaces import.meta.env.VITE_* at compile time, so these MUST be
# ARGs, not runtime ENVs. Defaults point to the backend on the Docker network.
ARG VITE_API_URL=""
ARG VITE_WS_URL=""
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_WS_URL=$VITE_WS_URL

# Copy source and build
COPY . .
RUN npm run build

# ── Production stage ─────────────────────────────────────────────────────────
FROM node:22-alpine AS production

RUN addgroup -g 1001 -S appgroup \
 && adduser  -u 1001 -S appuser -G appgroup

WORKDIR /app

# Install a lightweight static server
RUN npm install -g serve@14

# Copy built assets from build stage
COPY --from=build /app/dist ./dist

RUN chown -R appuser:appgroup /app
USER appuser

EXPOSE 3000

HEALTHCHECK \
  --interval=15s \
  --timeout=5s \
  --start-period=10s \
  --retries=3 \
  CMD wget -q --spider http://localhost:3000/ || exit 1

CMD ["serve", "-s", "dist", "-l", "3000"]


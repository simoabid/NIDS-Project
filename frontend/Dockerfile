# ─────────────────────────────────────────────────────────────────────────────
# Frontend — Multi-stage Dockerfile
# Stage 1: Build the Vite/React SPA
# Stage 2: Serve static files with a lightweight Node server
# ─────────────────────────────────────────────────────────────────────────────

FROM node:22-alpine AS build

WORKDIR /app

# Copy package files for layer caching
COPY package.json package-lock.json ./
RUN npm ci

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

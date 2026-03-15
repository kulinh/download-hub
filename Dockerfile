# ── Stage 1: Dependencies ────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ── Stage 2: Production image ────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

# Non-root user for least-privilege container (Node 7 security baseline)
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy production deps from Stage 1
COPY --from=deps /app/node_modules ./node_modules

# Copy application source
COPY src ./src
COPY views ./views
COPY public ./public
COPY scripts ./scripts
COPY package.json ./

# Ensure storage dir exists (R2 mode: local storage ignored; kept for dev)
RUN mkdir -p /app/storage/files && chown -R appuser:appgroup /app

# Writable dirs for files.json index (mounted in via volume in prod if needed)
# In R2 mode, files.json is the metadata catalog only (no local file blobs)
VOLUME ["/app/src/data", "/app/storage/files"]

USER appuser
EXPOSE 3000

# Health-check so Portainer/Docker knows when the container is healthy
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "src/server.js"]

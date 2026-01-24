# Slack Integration Service
# Multi-stage build for smaller final image

# ============ Builder Stage ============
FROM node:22-slim AS builder

WORKDIR /app

# Copy workspace files
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/common/package.json ./packages/common/
COPY packages/integrations/slack/package.json ./packages/integrations/slack/

# Install pnpm and dependencies
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
RUN pnpm install --frozen-lockfile

# Copy source
COPY tsconfig.base.json ./
COPY packages/common/ ./packages/common/
COPY packages/integrations/slack/ ./packages/integrations/slack/

# Build
RUN pnpm --filter @aesir/common build
RUN pnpm --filter @aesir/integration-slack build

# Deploy creates a standalone package with all dependencies resolved (no symlinks)
RUN pnpm --filter @aesir/integration-slack deploy --prod /deploy

# ============ Runtime Stage ============
FROM node:22-slim AS runtime

WORKDIR /app

# Install tini for proper PID 1 signal handling
RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*

# Copy deployed package (includes node_modules with resolved dependencies)
COPY --from=builder /deploy ./

# Create non-root user for security
RUN groupadd -g 1001 aesir && useradd -u 1001 -g aesir aesir
USER aesir

# Expose port (3003 for Slack - Linear=3001, GitHub=3002)
EXPOSE 3003

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3003/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]

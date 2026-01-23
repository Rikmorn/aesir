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

# ============ Runtime Stage ============
FROM node:22-slim AS runtime

WORKDIR /app

COPY --from=builder /app/packages/integrations/slack/dist ./dist
COPY --from=builder /app/packages/integrations/slack/package.json ./
COPY --from=builder /app/node_modules ./node_modules

# Create non-root user for security
RUN groupadd -g 1001 aesir && useradd -u 1001 -g aesir aesir
USER aesir

# Expose port (3003 for Slack - Linear=3001, GitHub=3002)
EXPOSE 3003

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3003/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

CMD ["node", "dist/main.js"]

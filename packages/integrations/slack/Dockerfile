# Slack Integration Service
# Multi-stage build for smaller final image

# ============ Builder Stage ============
FROM node:22-slim AS builder

WORKDIR /app

# Copy workspace files
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/types/package.json ./packages/types/
COPY packages/platform/package.json ./packages/platform/
# test-utils is a devDependency but pnpm deploy validates all workspace refs before filtering
COPY packages/test-utils/package.json ./packages/test-utils/
COPY packages/integrations/slack/package.json ./packages/integrations/slack/

# Install pnpm and dependencies
RUN corepack enable && corepack prepare pnpm@12.4.2 --activate
RUN pnpm install --frozen-lockfile

# Copy source
COPY tsconfig.base.json ./
COPY packages/types/ ./packages/types/
COPY packages/platform/ ./packages/platform/
COPY packages/integrations/slack/ ./packages/integrations/slack/

# Build
RUN pnpm --filter @aesir/types build
RUN pnpm --filter @aesir/platform build
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

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]

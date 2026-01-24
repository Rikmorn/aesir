# Aesir Agent Runtime
#
# Multi-stage build for running agents in production.
# Uses pnpm monorepo structure - builds all required packages.

FROM node:22-slim AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Copy workspace config files first (better caching)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY tsconfig.base.json ./

# Copy all package.json files for dependency resolution
COPY packages/common/package.json ./packages/common/
COPY packages/platform/package.json ./packages/platform/
COPY packages/observability/package.json ./packages/observability/
COPY packages/integrations/package.json ./packages/integrations/
COPY packages/integrations/linear/package.json ./packages/integrations/linear/
COPY packages/integrations/github/package.json ./packages/integrations/github/
COPY packages/integrations/slack/package.json ./packages/integrations/slack/
COPY packages/agents/package.json ./packages/agents/

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Copy source files
COPY packages/common/ ./packages/common/
COPY packages/platform/ ./packages/platform/
COPY packages/observability/ ./packages/observability/
COPY packages/integrations/ ./packages/integrations/
COPY packages/agents/ ./packages/agents/

# Copy langgraph config
COPY langgraph.json ./

# Build all packages in dependency order
RUN pnpm --filter @aesir/common build
RUN pnpm --filter @aesir/platform build
RUN pnpm --filter @aesir/observability build
RUN pnpm --filter @aesir/integration-linear build
RUN pnpm --filter @aesir/integration-github build
RUN pnpm --filter @aesir/integration-slack build
RUN pnpm --filter @aesir/integrations build
RUN pnpm --filter @aesir/agents build

# Production image (slim uses glibc, required for Temporal SDK native bindings)
FROM node:22-slim AS runtime

WORKDIR /app

# Install tini for proper PID 1 signal handling
RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*

# Copy built artifacts and node_modules
COPY --from=builder /app/packages/agents/dist ./packages/agents/dist
COPY --from=builder /app/packages/agents/package.json ./packages/agents/
COPY --from=builder /app/packages/common/dist ./packages/common/dist
COPY --from=builder /app/packages/common/package.json ./packages/common/
COPY --from=builder /app/packages/platform/dist ./packages/platform/dist
COPY --from=builder /app/packages/platform/package.json ./packages/platform/
COPY --from=builder /app/packages/observability/dist ./packages/observability/dist
COPY --from=builder /app/packages/observability/package.json ./packages/observability/
COPY --from=builder /app/packages/integrations/dist ./packages/integrations/dist
COPY --from=builder /app/packages/integrations/package.json ./packages/integrations/
COPY --from=builder /app/packages/integrations/linear/dist ./packages/integrations/linear/dist
COPY --from=builder /app/packages/integrations/linear/package.json ./packages/integrations/linear/
COPY --from=builder /app/packages/integrations/github/dist ./packages/integrations/github/dist
COPY --from=builder /app/packages/integrations/github/package.json ./packages/integrations/github/
COPY --from=builder /app/packages/integrations/slack/dist ./packages/integrations/slack/dist
COPY --from=builder /app/packages/integrations/slack/package.json ./packages/integrations/slack/
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/langgraph.json ./

# Copy workspace files for pnpm to resolve internal dependencies
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/package.json ./

# Don't run as root
RUN groupadd -g 1001 aesir && \
    useradd -u 1001 -g aesir aesir
USER aesir

# tini handles SIGTERM/SIGINT forwarding to Node.js
ENTRYPOINT ["/usr/bin/tini", "--"]

# Default command - start dev-agent (can be overridden for product-agent)
CMD ["node", "packages/agents/dist/scripts/start-dev-agent.js"]

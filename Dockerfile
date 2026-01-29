# Aesir Agent Runtime
#
# Multi-stage build for running agents in production.
# Uses pnpm deploy to create standalone package with resolved dependencies.

FROM node:22-slim AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Copy workspace config files first (better caching)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY tsconfig.base.json ./

# Copy all package.json files for dependency resolution
COPY packages/types/package.json ./packages/types/
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
COPY packages/types/ ./packages/types/
COPY packages/platform/ ./packages/platform/
COPY packages/observability/ ./packages/observability/
COPY packages/integrations/ ./packages/integrations/
COPY packages/agents/ ./packages/agents/

# Copy langgraph config
COPY langgraph.json ./

# Build all packages in dependency order
RUN pnpm --filter @aesir/types build
RUN pnpm --filter @aesir/platform build
RUN pnpm --filter @aesir/observability build
RUN pnpm --filter @aesir/integration-linear build
RUN pnpm --filter @aesir/integration-github build
RUN pnpm --filter @aesir/integration-slack build
RUN pnpm --filter @aesir/integrations build
RUN pnpm --filter @aesir/agents build

# Deploy creates a standalone package with all dependencies resolved (no symlinks)
RUN pnpm --filter @aesir/agents deploy --prod /deploy

# Copy langgraph.json to deploy folder
RUN cp langgraph.json /deploy/

# Production image (slim uses glibc, required for Temporal SDK native bindings)
FROM node:22-slim AS runtime

WORKDIR /app

# Install tini for proper PID 1 signal handling
RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*

# Copy deployed package (includes node_modules with resolved dependencies)
COPY --from=builder /deploy ./

# Don't run as root
RUN groupadd -g 1001 aesir && \
    useradd -u 1001 -g aesir aesir
USER aesir

# tini handles SIGTERM/SIGINT forwarding to Node.js
ENTRYPOINT ["/usr/bin/tini", "--"]

# Default command - start dev-agent HTTP service (can be overridden for product-agent)
# Other entry points:
#   - dev-agent worker: node dist/dev-agent/worker.js
#   - product-agent: node dist/product-agent/main.js
CMD ["node", "dist/dev-agent/main.js"]

# packages/integrations/github/Dockerfile
FROM node:22-slim AS builder

WORKDIR /app

# Copy workspace files
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/common/package.json ./packages/common/
COPY packages/integrations/github/package.json ./packages/integrations/github/

# Install pnpm and dependencies
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
RUN pnpm install --frozen-lockfile

# Copy source
COPY tsconfig.base.json ./
COPY packages/common/ ./packages/common/
COPY packages/integrations/github/ ./packages/integrations/github/

# Build
RUN pnpm --filter @aesir/common build
RUN pnpm --filter @aesir/integration-github build

# Deploy creates a standalone package with all dependencies resolved (no symlinks)
RUN pnpm --filter @aesir/integration-github deploy --prod /deploy

# Production image
FROM node:22-slim AS runtime

WORKDIR /app

# Install tini for proper PID 1 signal handling
RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*

# Copy deployed package (includes node_modules with resolved dependencies)
COPY --from=builder /deploy ./

RUN groupadd -g 1001 aesir && useradd -u 1001 -g aesir aesir
USER aesir

EXPOSE 3002

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]

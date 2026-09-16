# packages/integrations/linear/Dockerfile
FROM node:22-slim AS builder

WORKDIR /app

# Copy workspace files
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/types/package.json ./packages/types/
COPY packages/platform/package.json ./packages/platform/
# test-utils is a devDependency but pnpm deploy validates all workspace refs before filtering
COPY packages/test-utils/package.json ./packages/test-utils/
COPY packages/integrations/linear/package.json ./packages/integrations/linear/

# Install pnpm and dependencies
RUN corepack enable && corepack prepare pnpm@12.4.2 --activate
RUN pnpm install --frozen-lockfile

# Copy source
COPY tsconfig.base.json ./
COPY packages/types/ ./packages/types/
COPY packages/platform/ ./packages/platform/
COPY packages/integrations/linear/ ./packages/integrations/linear/

# Build
RUN pnpm --filter @aesir/types build
RUN pnpm --filter @aesir/platform build
RUN pnpm --filter @aesir/integration-linear build

# Deploy creates a standalone package with all dependencies resolved (no symlinks)
RUN pnpm --filter @aesir/integration-linear deploy --prod /deploy

# Production image
FROM node:22-slim AS runtime

WORKDIR /app

# Install tini for proper PID 1 signal handling
RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*

# Copy deployed package (includes node_modules with resolved dependencies)
COPY --from=builder /deploy ./

RUN groupadd -g 1001 aesir && useradd -u 1001 -g aesir aesir
USER aesir

EXPOSE 3001

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]

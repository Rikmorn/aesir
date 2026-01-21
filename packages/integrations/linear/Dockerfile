# packages/integrations/linear/Dockerfile
FROM node:20-slim AS builder

WORKDIR /app

# Copy workspace files
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/common/package.json ./packages/common/
COPY packages/integrations/linear/package.json ./packages/integrations/linear/

# Install pnpm and dependencies
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
RUN pnpm install --frozen-lockfile

# Copy source
COPY tsconfig.base.json ./
COPY packages/common/ ./packages/common/
COPY packages/integrations/linear/ ./packages/integrations/linear/

# Build
RUN pnpm --filter @aesir/common build
RUN pnpm --filter @aesir/integration-linear build

# Production image
FROM node:20-slim AS runtime

WORKDIR /app

COPY --from=builder /app/packages/integrations/linear/dist ./dist
COPY --from=builder /app/packages/integrations/linear/package.json ./
COPY --from=builder /app/node_modules ./node_modules

RUN groupadd -g 1001 aesir && useradd -u 1001 -g aesir aesir
USER aesir

EXPOSE 3001

CMD ["node", "dist/main.js"]

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

# Production image
FROM node:22-slim AS runtime

WORKDIR /app

COPY --from=builder /app/packages/integrations/github/dist ./dist
COPY --from=builder /app/packages/integrations/github/package.json ./
COPY --from=builder /app/node_modules ./node_modules

RUN groupadd -g 1001 aesir && useradd -u 1001 -g aesir aesir
USER aesir

EXPOSE 3002

CMD ["node", "dist/main.js"]

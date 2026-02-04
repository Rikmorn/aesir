# packages/dashboard/Dockerfile
#
# Multi-stage build for Next.js standalone output in a pnpm monorepo.
# Unlike other services that use `pnpm deploy --prod`, Next.js standalone mode
# bundles all dependencies into .next/standalone, producing a minimal output.

# Stage 1: Base image with pnpm
FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Stage 2: Install dependencies
FROM base AS deps
WORKDIR /app

# Copy workspace config files first (better layer caching)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY tsconfig.base.json ./

# Copy ALL workspace package.json files for pnpm resolution
# pnpm requires the full workspace structure even when filtering
COPY packages/types/package.json ./packages/types/
COPY packages/platform/package.json ./packages/platform/
COPY packages/observability/package.json ./packages/observability/
COPY packages/agents/package.json ./packages/agents/
COPY packages/test-utils/package.json ./packages/test-utils/
COPY packages/integrations/linear/package.json ./packages/integrations/linear/
COPY packages/integrations/github/package.json ./packages/integrations/github/
COPY packages/integrations/slack/package.json ./packages/integrations/slack/
COPY packages/dashboard/package.json ./packages/dashboard/

RUN pnpm install --frozen-lockfile

# Stage 3: Build Next.js
FROM base AS builder
WORKDIR /app

# Copy installed dependencies from deps stage
COPY --from=deps /app ./

# Copy full source (outputFileTracingRoot is monorepo root, so Next.js traces from here)
COPY . .

# Dashboard has no workspace:* dependencies -- it uses drizzle-orm and pg directly.
# No need to build @aesir/types or @aesir/platform.
# Build Next.js (produces .next/standalone with all traced dependencies)
RUN pnpm --filter @aesir/dashboard build

# Stage 4: Minimal production runner
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

# Create non-root user
RUN groupadd -g 1001 aesir && useradd -u 1001 -g aesir aesir

# Copy standalone output
# Because outputFileTracingRoot points to monorepo root, the standalone
# output mirrors the monorepo directory structure (packages/dashboard/...)
COPY --from=builder /app/packages/dashboard/.next/standalone ./

# Static files are NOT included in standalone output -- copy separately
COPY --from=builder /app/packages/dashboard/.next/static ./packages/dashboard/.next/static

# Public assets (fonts, images, etc.)
COPY --from=builder /app/packages/dashboard/public ./packages/dashboard/public

USER aesir

EXPOSE 3005

ENV PORT=3005
ENV HOSTNAME="0.0.0.0"

# Next.js standalone server handles SIGTERM/SIGINT -- no tini needed
CMD ["node", "packages/dashboard/server.js"]

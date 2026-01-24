# Aesir Agent Runtime
#
# Multi-stage build for running agents in production.
# Includes Node.js runtime with all dependencies.

FROM node:20-slim AS builder

WORKDIR /app

# Install dependencies first (better caching)
# --legacy-peer-deps needed due to LangChain peer dependency version mismatches
COPY package*.json ./
RUN npm ci --legacy-peer-deps

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/
COPY langgraph.json ./

RUN npm run build

# Production image (slim uses glibc, required for Temporal SDK native bindings)
FROM node:20-slim AS runtime

WORKDIR /app

# Install tini for proper PID 1 signal handling
RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev --legacy-peer-deps

# Copy built artifacts
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/langgraph.json ./

# Don't run as root
RUN groupadd -g 1001 aesir && \
    useradd -u 1001 -g aesir aesir
USER aesir

# tini handles SIGTERM/SIGINT forwarding to Node.js
ENTRYPOINT ["/usr/bin/tini", "--"]

# Default command (can be overridden)
CMD ["node", "dist/scripts/start-dev-agent.js"]

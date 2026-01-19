# Technology Stack Recommendations: Tooling & Developer Experience

**Project:** Aesir - Agentic Development Platform v2.0 Foundation
**Researched:** 2026-01-19
**Overall Confidence:** HIGH (verified via official sources)
**Dimension:** Tooling, Testing, CI/CD, Logging, Configuration

> **Note:** This research complements `STACK.md` (multi-agent orchestration frameworks). This document focuses on developer tooling, testing infrastructure, and operational foundations.

## Executive Summary

This stack recommendation focuses on establishing a solid foundation for an existing TypeScript agentic platform. The current codebase already uses Vitest, TypeScript 5.7+, and has a custom structured logger. Recommendations prioritize:

1. **Biome** over ESLint+Prettier for 10-25x faster linting/formatting
2. **pino** to replace custom logger with production-grade structured logging
3. **dotenv-flow** for multi-environment configuration management
4. **MCP (Model Context Protocol)** for standardized agent-integration communication
5. **Testcontainers** for reliable integration testing with Docker
6. **tsyringe** for lightweight dependency injection

---

## Core Technologies

### Build & Development Tools

| Technology | Version | Purpose | Rationale |
|------------|---------|---------|-----------|
| **Biome** | ^2.0.0 | Linting + Formatting | 10-25x faster than ESLint+Prettier, single binary, zero-config, 425 lint rules. Biome v2.0 (June 2025) added plugins and type-aware linting. |
| TypeScript | ^5.7.0 | Type System | Already in use. Keep current. Strict mode enabled. |
| tsx | ^4.0.0 | Dev Runtime | Already in use. Fast TypeScript execution without compilation. |
| Node.js | >=22.0.0 | Runtime | Upgrade from 20 to 22 LTS for better ESM support, native test runner improvements. |

### Logging & Observability

| Technology | Version | Purpose | Rationale |
|------------|---------|---------|-----------|
| **pino** | ^10.2.0 | Structured Logging | 5-10x faster than alternatives, JSON-native, async I/O, child loggers, redaction. Current custom logger should be replaced. |
| **pino-pretty** | ^13.0.0 | Dev Formatting | Human-readable logs in development. Install as devDependency only. |
| pino-http | ^10.0.0 | HTTP Request Logging | Optional - use if adding HTTP server layer. |

### Environment Configuration

| Technology | Version | Purpose | Rationale |
|------------|---------|---------|-----------|
| **dotenv-flow** | ^4.1.0 | Multi-env Config | Replaces plain dotenv. Supports `.env.development`, `.env.test`, `.env.production`, `.env.*.local`. Built-in TypeScript types since v4. |

### Agent-Integration Communication

| Technology | Version | Purpose | Rationale |
|------------|---------|---------|-----------|
| **@modelcontextprotocol/server** | ^1.x | MCP Server SDK | Build MCP servers to expose integrations (Linear, GitHub, Slack) as tools. Industry standard adopted by Anthropic, OpenAI, Google, Microsoft. |
| **@modelcontextprotocol/client** | ^1.x | MCP Client SDK | Connect agents to MCP servers. 97M+ monthly SDK downloads. |
| zod | ^3.25.0 | Schema Validation | Peer dependency for MCP SDK. Already in use. |

### Dependency Injection

| Technology | Version | Purpose | Rationale |
|------------|---------|---------|-----------|
| **tsyringe** | ^4.8.0 | DI Container | Microsoft-maintained, lightweight, decorator-based, TypeScript-native. Better fit for this codebase than heavier InversifyJS. |
| reflect-metadata | ^0.2.0 | Decorator Support | Required peer dependency for tsyringe. |

---

## Testing Infrastructure

| Technology | Version | Purpose | Rationale |
|------------|---------|---------|-----------|
| **Vitest** | ^3.0.0 | Unit & Integration Tests | Already in use. 10-20x faster than Jest, native ESM/TypeScript, Jest-compatible API. |
| **testcontainers** | ^11.11.0 | Docker Integration Tests | Spin up PostgreSQL, Temporal containers for integration tests. Isolated test environments. |
| @vitest/coverage-v8 | ^3.0.0 | Code Coverage | V8-based coverage, already configured. |

### Test Strategy

```
Testing Pyramid for Aesir:

    /\          E2E Tests (Temporal workflows, full agent runs)
   /  \         - Use real containers, slower, run in CI only
  /----\
 /      \       Integration Tests (testcontainers)
/        \      - PostgreSQL, Docker sandbox, API integrations
/----------\    - Run locally, moderate speed
/            \  Unit Tests (Vitest)
/______________\ - Fast, isolated, mock dependencies
                - Run continuously in watch mode
```

---

## CI/CD Infrastructure

| Technology | Version | Purpose | Rationale |
|------------|---------|---------|-----------|
| GitHub Actions | N/A | CI/CD Platform | Already implied. Native to GitHub, good TypeScript support. |
| actions/setup-node | v4 | Node.js Setup | Use with node-version-file for consistency. |
| actions/cache | v4 | Dependency Caching | Cache node_modules and pnpm store. |

### CI/CD Patterns

**Recommended workflow structure:**

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [master, main]
  pull_request:
    branches: [master, main]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: '.nvmrc'
          cache: 'yarn'
      - run: yarn install --frozen-lockfile
      - run: yarn biome check ./src  # Fast, run first

  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: '.nvmrc'
          cache: 'yarn'
      - run: yarn install --frozen-lockfile
      - run: yarn tsc --noEmit

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: '.nvmrc'
          cache: 'yarn'
      - run: yarn install --frozen-lockfile
      - run: yarn test:coverage

  integration:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: '.nvmrc'
          cache: 'yarn'
      - run: yarn install --frozen-lockfile
      - run: yarn test:integration
        env:
          DATABASE_URL: postgresql://postgres:test@localhost:5432/test
```

---

## Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **zod** | ^3.25.0 | Schema Validation | Already in use. Continue for all runtime validation. |
| **neverthrow** | ^8.0.0 | Result Types | Consider for explicit error handling in agents. Avoids try/catch sprawl. |
| **nanoid** | ^5.0.0 | ID Generation | Smaller, faster than uuid for non-cryptographic IDs. |
| **date-fns** | ^4.0.0 | Date Utilities | Preferred over moment.js (deprecated) or dayjs. Tree-shakeable. |

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not Alternative |
|----------|-------------|-------------|---------------------|
| **Linting/Formatting** | Biome | ESLint + Prettier | 10-25x slower, 4+ config files, 127+ npm packages. Biome handles both in one tool. |
| **Logging** | pino | winston | Winston 2-5x slower, more memory overhead. pino designed for high-throughput. |
| **Logging** | pino | current custom logger | Custom logger lacks: transports, redaction, child loggers, pino-pretty, production hardening. |
| **Env Config** | dotenv-flow | dotenv | dotenv lacks multi-environment support (`.env.development`, `.env.test`). |
| **Env Config** | dotenv-flow | ts-dotenv | ts-dotenv has schema validation but less ecosystem adoption. dotenv-flow has 4M+ weekly downloads. |
| **Testing** | Vitest | Jest | Already using Vitest. Jest slower, requires more config for ESM/TypeScript. |
| **DI** | tsyringe | InversifyJS | InversifyJS heavier, more complex. tsyringe lightweight, sufficient for this use case. |
| **DI** | tsyringe | awilix | awilix not decorator-based, different paradigm. tsyringe more idiomatic for TypeScript. |
| **Agent Communication** | MCP | Custom REST APIs | MCP is industry standard (Anthropic, OpenAI, Google, Microsoft). Future-proof. |
| **Agent Communication** | MCP | Direct function calls | MCP enables tool discovery, isolation, and works across process boundaries. |

---

## What NOT to Use

| Technology | Reason |
|------------|--------|
| **ESLint + Prettier** | Slower, more complex. Biome replaces both with better performance. |
| **Winston** | Slower than pino. Only choose if you need complex transports not supported by pino. |
| **Jest** | Already using Vitest. No reason to migrate backwards. |
| **Lerna** | Deprecated in favor of Nx or Turborepo for monorepos. Not needed for current structure. |
| **moment.js** | Deprecated. Use date-fns instead. |
| **@types/dotenv-flow** | Built-in types since v4.0.0. Remove if present. |
| **MCP v2 SDK** | v2 is pre-alpha. Use v1.x for production. |

---

## Version Compatibility Notes

### Biome Migration

Biome v2.0 requires configuration migration from v1:

```bash
# Migrate existing config
npx @biomejs/biome migrate --write

# Or start fresh
npx @biomejs/biome init
```

### tsyringe Requirements

tsyringe requires TypeScript decorator support:

```json
// tsconfig.json additions
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

### MCP SDK Peer Dependencies

```bash
npm install @modelcontextprotocol/server @modelcontextprotocol/client zod
```

### pino TypeScript Types

pino includes built-in TypeScript definitions. No @types package needed.

---

## Installation Commands

### Core Development Tools

```bash
# Biome (linting + formatting)
yarn add -D @biomejs/biome

# Initialize Biome config
npx @biomejs/biome init
```

### Logging

```bash
# Production logging
yarn add pino

# Development pretty-printing
yarn add -D pino-pretty
```

### Environment Management

```bash
# Multi-environment config
yarn add dotenv-flow

# Remove old types if present
yarn remove @types/dotenv-flow
```

### Agent Communication (MCP)

```bash
# MCP server and client SDKs
yarn add @modelcontextprotocol/server @modelcontextprotocol/client
# zod already installed as peer dependency
```

### Dependency Injection

```bash
# DI container + reflect polyfill
yarn add tsyringe reflect-metadata
```

### Testing Infrastructure

```bash
# Testcontainers for Docker-based integration tests
yarn add -D testcontainers
```

---

## Configuration Examples

### biome.json

```json
{
  "$schema": "https://biomejs.dev/schemas/2.0.0/schema.json",
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true
  },
  "files": {
    "ignoreUnknown": true,
    "include": ["src/**/*.ts", "src/**/*.tsx"]
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true
    }
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "trailingCommas": "es5"
    }
  }
}
```

### pino Logger Setup

```typescript
// src/logging/logger.ts
import pino from 'pino';

const transport = process.env.NODE_ENV === 'development'
  ? {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
      },
    }
  : undefined;

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport,
  redact: ['password', 'secret', 'token', 'authorization'],
});

// Create child loggers with context
export const createLogger = (context: Record<string, unknown>) =>
  logger.child(context);
```

### dotenv-flow Setup

```typescript
// src/config/env.ts
import dotenvFlow from 'dotenv-flow';

// Load environment-specific .env files
// Order: .env -> .env.local -> .env.{NODE_ENV} -> .env.{NODE_ENV}.local
dotenvFlow.config();

// Validate required environment variables
const required = ['DATABASE_URL', 'ANTHROPIC_API_KEY'] as const;
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}
```

### tsyringe DI Setup

```typescript
// src/container.ts
import 'reflect-metadata';
import { container } from 'tsyringe';
import { LinearClient } from './integrations/linear/client';
import { GitHubClient } from './integrations/github/client';
import { SlackClient } from './integrations/slack/client';

// Register integrations as singletons
container.registerSingleton('LinearClient', LinearClient);
container.registerSingleton('GitHubClient', GitHubClient);
container.registerSingleton('SlackClient', SlackClient);

export { container };
```

### Testcontainers Example

```typescript
// src/integrations/linear/client.integration.test.ts
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';

describe('Database Integration', () => {
  let container: StartedPostgreSqlContainer;

  beforeAll(async () => {
    container = await new PostgreSqlContainer()
      .withDatabase('test')
      .start();

    process.env.DATABASE_URL = container.getConnectionUri();
  }, 60_000);

  afterAll(async () => {
    await container.stop();
  });

  it('should connect to database', async () => {
    // Test with real PostgreSQL
  });
});
```

---

## Migration Path from Current State

### Phase 1: Immediate (Low Risk)

1. Add Biome alongside existing `tsc --noEmit` lint
2. Add dotenv-flow, keep existing dotenv
3. Add pino, parallel with custom logger

### Phase 2: Transition

1. Replace custom logger calls with pino
2. Migrate environment loading to dotenv-flow
3. Run Biome check in CI

### Phase 3: Cleanup

1. Remove custom logger
2. Remove plain dotenv
3. Remove `lint: "tsc --noEmit"` in favor of `lint: "biome check"`

---

## Sources

### Official Documentation (HIGH confidence)
- [Biome Official](https://biomejs.dev/) - v2.x, 425 rules, 35x faster than Prettier
- [Model Context Protocol](https://modelcontextprotocol.io/) - Spec v2025-11-25
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) - v1.x production, v2 pre-alpha
- [pino GitHub](https://github.com/pinojs/pino) - v10.2.1, 17.2k stars
- [Vitest](https://vitest.dev/) - v4.0.17
- [dotenv-flow GitHub](https://github.com/kerimdzhanov/dotenv-flow) - v4.1.0
- [tsyringe GitHub](https://github.com/microsoft/tsyringe) - Microsoft maintained
- [Testcontainers Node](https://node.testcontainers.org/) - v11.11.0

### Comparison & Best Practices (MEDIUM confidence)
- [Biome vs ESLint 2025](https://medium.com/better-dev-nextjs-react/biome-vs-eslint-prettier-the-2025-linting-revolution-you-need-to-know-about-ec01c5d5b6c8)
- [Vitest vs Jest 2025](https://betterstack.com/community/guides/scaling-nodejs/vitest-vs-jest/)
- [pino Logging Guide](https://betterstack.com/community/guides/logging/how-to-install-setup-and-use-pino-to-log-node-js-applications/)
- [TypeScript DI Comparison](https://leapcell.io/blog/dependency-injection-beyond-nestjs-a-deep-dive-into-tsyringe-and-inversifyjs)
- [GitHub Actions Monorepo](https://graphite.com/guides/monorepo-with-github-actions)
- [MCP Year in Review](https://blog.modelcontextprotocol.io/posts/2025-11-25-first-mcp-anniversary/)

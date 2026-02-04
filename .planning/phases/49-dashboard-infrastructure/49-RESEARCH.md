# Phase 49: Dashboard Infrastructure - Research

**Researched:** 2026-02-04
**Domain:** Next.js monorepo integration, Docker deployment, Drizzle read-only access
**Confidence:** HIGH

## Summary

Phase 49 establishes a Next.js dashboard as a new pnpm workspace package (`@aesir/dashboard`) that reads existing Postgres schemas, runs in Docker Compose on port 3005, and passes the monorepo's Biome linting and TypeScript checks.

The spec calls for Next.js 15, but Next.js 16 is now the latest stable version (released October 2025). **Recommendation: Use Next.js 15.5.x (latest 15.5.9)** because (1) the spec explicitly specifies Next.js 15, (2) Next.js 16 introduces significant breaking changes (middleware renamed to proxy, async request APIs enforced, Turbopack as default) that add unnecessary migration complexity, (3) Next.js 15.5.9 includes all critical security patches (CVE-2025-55184, CVE-2025-55183, CVE-2025-67779), and (4) Next.js 15 is in Maintenance LTS receiving security patches. Upgrading to 16 can be a separate phase when the dashboard has more substance to validate against. The spec's `middleware.ts` auth-ready passthrough maps directly to Next.js 15's middleware.ts convention (in Next.js 16 this was renamed to proxy.ts).

The dashboard uses standalone output mode for Docker, Tailwind CSS 4's zero-config CSS-first approach, shadcn/ui for copy-paste components, and Drizzle ORM for type-safe read-only database queries against existing `agents.*` and `{linear,github,slack}.*` schemas. The service layer pattern abstracts all database access for future API extraction.

**Primary recommendation:** Scaffold a Next.js 15.5.x App Router project manually (not `create-next-app`, which creates its own root), configure `output: 'standalone'` with `outputFileTracingRoot` pointing to the monorepo root, use Biome (not ESLint) for linting, and build a multi-stage Dockerfile following the existing integration service pattern.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| next | 15.5.9 | App Router framework | Latest security-patched 15.x, spec-specified, Maintenance LTS |
| react | 19.0.3+ | UI library | Required by Next.js 15.5, security-patched |
| react-dom | 19.0.3+ | DOM rendering | Required by Next.js 15.5 |
| tailwindcss | ^4.0.0 | Utility-first CSS | CSS-first config, no tailwind.config.js needed |
| @tailwindcss/postcss | ^4.0.0 | PostCSS plugin for Tailwind 4 | Required for Next.js CSS pipeline |
| drizzle-orm | ^0.45.1 | Type-safe SQL queries | Already used in the project (match existing version) |
| pg | ^8.17.2 | PostgreSQL client | Already used in the project |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| class-variance-authority | latest | Component variant API | Required by shadcn/ui components |
| clsx | latest | Conditional class names | Required by shadcn/ui cn() utility |
| tailwind-merge | latest | Tailwind class deduplication | Required by shadcn/ui cn() utility |
| lucide-react | latest | Icon library | Required by shadcn/ui components |
| tw-animate-css | latest | CSS animations | Replaces tailwindcss-animate for Tailwind v4 |

### Dev Dependencies

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| typescript | ^5.7.0 | TypeScript compiler | Match existing monorepo version |
| @types/node | ^22.0.0 | Node.js type definitions | Match existing monorepo version |
| @types/react | ^19.0.0 | React type definitions | Required for TSX files |
| @types/react-dom | ^19.0.0 | React DOM type definitions | Required for TSX files |
| @types/pg | ^8.16.0 | PostgreSQL type definitions | Match existing pattern |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Next.js 15.5.x | Next.js 16 | 16 is latest stable but breaks middleware.ts -> proxy.ts, enforces async request APIs, and changes default bundler to Turbopack. Not worth the risk for an infrastructure phase. |
| Tailwind CSS 4 | Tailwind CSS 3 | v4 is zero-config, faster, and the ecosystem (shadcn/ui) has fully migrated. No reason to use v3 for a new project. |
| Biome | ESLint | Project already uses Biome. Next.js 15.5 deprecated `next lint`, Next.js 16 removed it entirely. Biome is the right choice. |
| shadcn/ui (copy-paste) | Radix UI (direct) | shadcn/ui wraps Radix with pre-styled components. The copy-paste model means no dependency version conflicts. Spec explicitly requires shadcn/ui. |
| node-postgres (pg) | postgres.js | Existing services use `pg` (node-postgres) with `drizzle-orm/node-postgres`. Match the existing pattern. |

**Installation:**
```bash
pnpm add next@15.5.9 react@^19.0.3 react-dom@^19.0.3 tailwindcss@^4.0.0 @tailwindcss/postcss@^4.0.0 drizzle-orm@^0.45.1 pg@^8.17.2 class-variance-authority clsx tailwind-merge lucide-react tw-animate-css
pnpm add -D typescript@^5.7.0 @types/node@^22.0.0 @types/react@^19.0.0 @types/react-dom@^19.0.0 @types/pg@^8.16.0
```

## Architecture Patterns

### Recommended Project Structure

```
packages/dashboard/
  src/
    app/                      # Next.js App Router pages
      layout.tsx              # Root layout (html, body, providers)
      page.tsx                # System overview (home) -- minimal placeholder for INFRA
      api/
        health/
          route.ts            # GET /api/health -> 200
      globals.css             # Tailwind imports + shadcn/ui CSS variables
    components/
      ui/                     # shadcn/ui components (copy-pasted)
    services/                 # Data access layer (server-only)
      conversations.ts        # Query agents.conversations
    lib/
      db.ts                   # Drizzle client (read-only pool)
      utils.ts                # cn() utility for shadcn/ui
    middleware.ts              # Auth-ready passthrough
  public/                     # Static assets
  next.config.ts              # Standalone output, outputFileTracingRoot
  postcss.config.mjs          # @tailwindcss/postcss
  tsconfig.json               # Extends monorepo base with JSX support
  components.json             # shadcn/ui configuration
  package.json                # @aesir/dashboard
  Dockerfile                  # Multi-stage standalone build
```

### Pattern 1: Next.js Standalone Output for Monorepo Docker

**What:** Configure Next.js to produce a self-contained standalone build that includes all workspace dependencies, enabling a minimal Docker image.

**When to use:** Always for Docker deployment of a Next.js app inside a pnpm workspace monorepo.

**Configuration (`next.config.ts`):**
```typescript
import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  output: "standalone",
  // CRITICAL for monorepo: tells Next.js to trace dependencies from the monorepo root
  // Without this, workspace:* packages won't be copied into .next/standalone
  outputFileTracingRoot: path.join(__dirname, "../../"),
  // Biome handles linting, not ESLint
  eslint: {
    ignoreDuringBuilds: true,
  },
  // No TypeScript errors should block build (typecheck runs separately)
  typescript: {
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
```

**Why `outputFileTracingRoot` is critical:** Next.js traces file dependencies starting from the project directory. In a monorepo, the dashboard imports from `@aesir/agents` (for schema types) and `@aesir/platform` (for logging). Without `outputFileTracingRoot` pointing to the monorepo root, these workspace packages won't be included in the standalone output, causing runtime "Cannot find module" errors.

### Pattern 2: Drizzle Read-Only Client for Dashboard

**What:** A dedicated database client that imports schema definitions from existing packages and provides read-only query access.

**When to use:** For the dashboard's service layer.

**Example (`src/lib/db.ts`):**
```typescript
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
// Import schemas from existing packages -- NOT duplicate definitions
import * as agentsSchema from "@aesir/agents/shared/db/schema";
// For MCP permissions, import directly from the package schemas

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: Number.parseInt(process.env.DB_PORT || "5432", 10),
  user: process.env.DB_USER || "aesir",
  password: process.env.DB_PASSWORD || "aesir",
  database: process.env.DB_NAME || "aesir",
  max: 5,  // Lower pool size -- dashboard is read-only, lower concurrency
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

export const db = drizzle(pool, {
  schema: { ...agentsSchema },
});
```

**Key consideration:** The dashboard should NOT import from internal package paths that aren't exported. Check each package's `exports` field in package.json to confirm the schema is accessible. The `@aesir/agents` package exports `"./*"` as `"./dist/*.js"`, so `@aesir/agents/shared/db/schema` should resolve to `@aesir/agents/dist/shared/db/schema.js`. Verify this at implementation time.

**Alternative approach if exports don't work:** Define minimal read-only schema definitions in the dashboard package itself, duplicating just the table definitions (not the full schema files) needed for queries. This trades slight duplication for independence.

### Pattern 3: Service Layer Abstraction

**What:** All database queries go through typed service functions, not raw Drizzle calls in components.

**When to use:** Every page that reads data.

**Example (`src/services/conversations.ts`):**
```typescript
import { desc, eq, count } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversations, agentEvents } from "@aesir/agents/shared/db/schema";

export interface ConversationSummary {
  id: string;
  agentDefinitionId: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export async function listConversations(opts?: {
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<ConversationSummary[]> {
  const rows = await db
    .select({
      id: conversations.id,
      agentDefinitionId: conversations.agent_definition_id,
      status: conversations.status,
      createdAt: conversations.created_at,
      updatedAt: conversations.updated_at,
    })
    .from(conversations)
    .orderBy(desc(conversations.updated_at))
    .limit(opts?.limit ?? 50)
    .offset(opts?.offset ?? 0);

  return rows;
}
```

### Pattern 4: Auth-Ready Middleware Passthrough

**What:** A middleware.ts file that matches all routes but does nothing, ready for future auth injection.

**When to use:** From Phase 49 onwards. When auth is added later, this single file gets the auth check logic.

**Example (`src/middleware.ts`):**
```typescript
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(_request: NextRequest) {
  // Auth-ready passthrough: when auth is added, check session here
  // Example future auth:
  // const session = await getSession(request);
  // if (!session) return NextResponse.redirect(new URL("/login", request.url));
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match all paths except static files, _next, and api/health
    "/((?!_next/static|_next/image|favicon.ico|api/health).*)",
  ],
};
```

### Pattern 5: Tailwind CSS 4 Zero-Config Setup

**What:** Tailwind CSS 4 uses CSS-first configuration with no `tailwind.config.js`.

**When to use:** All new projects using Tailwind 4.

**PostCSS config (`postcss.config.mjs`):**
```javascript
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
```

**CSS entry (`src/app/globals.css`):**
```css
@import "tailwindcss";
@import "tw-animate-css";

/* shadcn/ui CSS variables using oklch color space */
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  /* ... additional shadcn/ui theme mappings */
}

@layer base {
  :root {
    --background: oklch(1 0 0);
    --foreground: oklch(0.145 0 0);
    /* ... full shadcn/ui color palette */
  }
  .dark {
    --background: oklch(0.145 0 0);
    --foreground: oklch(0.985 0 0);
    /* ... dark mode overrides */
  }
}
```

### Pattern 6: Docker Multi-Stage Build for Next.js Standalone

**What:** A Dockerfile that builds the Next.js app in a builder stage and creates a minimal runtime image using the standalone output.

**When to use:** For the dashboard Docker deployment.

**Key differences from existing Dockerfiles:** The existing services (agents, integrations) use `pnpm deploy --prod` to create standalone packages. Next.js has its own standalone output mode (`.next/standalone`) which is more appropriate because it uses file tracing to include only the exact files needed at runtime.

**Dockerfile pattern:**
```dockerfile
FROM node:22-slim AS base

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

FROM base AS deps
WORKDIR /app

# Copy workspace config for dependency resolution
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY tsconfig.base.json ./

# Copy all package.json files needed for dependency resolution
COPY packages/types/package.json ./packages/types/
COPY packages/platform/package.json ./packages/platform/
COPY packages/agents/package.json ./packages/agents/
COPY packages/observability/package.json ./packages/observability/
COPY packages/dashboard/package.json ./packages/dashboard/

# Install dependencies
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/*/node_modules ./packages/*/node_modules
COPY . .

# Build workspace dependencies first
RUN pnpm --filter @aesir/types build
RUN pnpm --filter @aesir/platform build
RUN pnpm --filter @aesir/agents exec tsc -b tsconfig.build.json

# Build Next.js app (produces .next/standalone)
RUN pnpm --filter @aesir/dashboard build

FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

# Create non-root user
RUN groupadd -g 1001 aesir && useradd -u 1001 -g aesir aesir

# Copy standalone build output
# outputFileTracingRoot means standalone mirrors monorepo structure
COPY --from=builder /app/packages/dashboard/.next/standalone ./
COPY --from=builder /app/packages/dashboard/.next/static ./packages/dashboard/.next/static
COPY --from=builder /app/packages/dashboard/public ./packages/dashboard/public

USER aesir

EXPOSE 3005

ENV PORT=3005
ENV HOSTNAME="0.0.0.0"

# The standalone server.js is at the monorepo-relative path
CMD ["node", "packages/dashboard/server.js"]
```

### Anti-Patterns to Avoid

- **Importing integration SDK clients directly:** The dashboard reads from Postgres and calls the agent service API. It NEVER imports `@linear/sdk`, `@octokit/rest`, or `@slack/bolt` directly. Follow the existing dependency rules.

- **Duplicating schema definitions:** Import Drizzle table definitions from the source packages (`@aesir/agents`, etc.), don't copy-paste schema files. If import paths don't work due to package exports, create a thin re-export layer, but don't duplicate the table definitions themselves.

- **Running `pnpm install` inside `.next/standalone`:** The standalone output includes pre-traced node_modules. Installing additional packages there breaks the traced dependency tree.

- **Using `create-next-app` to scaffold inside the monorepo:** `create-next-app` initializes git, installs dependencies, and creates its own root. Instead, manually create the package directory and add files. Use `npx shadcn@latest init` only after the basic Next.js setup is working.

- **Using ESLint or `next lint`:** The project uses Biome. Next.js 15.5 already deprecated `next lint`. Configure `eslint: { ignoreDuringBuilds: true }` in next.config.ts.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CSS class merging | Custom class string builder | `cn()` from `clsx` + `tailwind-merge` | Handles Tailwind specificity conflicts correctly |
| Component variants | Custom prop-to-class mapping | `class-variance-authority` (cva) | Type-safe variant API, standard in shadcn/ui ecosystem |
| Health check endpoint | Custom Express server | Next.js API route (`app/api/health/route.ts`) | Native to the framework, no additional server needed |
| CSS animations | Custom keyframes | `tw-animate-css` | Pre-built animation classes compatible with shadcn/ui and Tailwind v4 |
| PostCSS pipeline | Manual CSS processing | `@tailwindcss/postcss` | Tailwind v4's official PostCSS plugin handles everything |

**Key insight:** The dashboard infrastructure phase should produce the minimum viable scaffold. Don't build UI components, views, or data visualization in this phase -- that's for future phases. Focus on proving the build pipeline, Docker deployment, type checking, linting, and service layer pattern work end-to-end.

## Common Pitfalls

### Pitfall 1: Missing `outputFileTracingRoot` in Monorepo

**What goes wrong:** The Next.js standalone build doesn't include workspace packages (`@aesir/agents`, `@aesir/platform`). The Docker container starts but crashes with "Cannot find module '@aesir/agents'" errors.

**Why it happens:** By default, Next.js traces dependencies starting from the project directory (`packages/dashboard/`). Files outside this directory aren't traced or included in `.next/standalone`.

**How to avoid:** Set `outputFileTracingRoot` to the monorepo root (`path.join(__dirname, "../../")`) in `next.config.ts`. This tells Next.js to trace from the monorepo root, including workspace packages.

**Warning signs:** "Cannot find module" errors when running the standalone build, or the standalone output directory being suspiciously small.

### Pitfall 2: TypeScript Config Incompatibility with JSX

**What goes wrong:** TypeScript compilation fails because the monorepo's `tsconfig.base.json` uses `"module": "NodeNext"` / `"moduleResolution": "NodeNext"` but Next.js requires `"jsx": "preserve"` and often `"module": "ESNext"`.

**Why it happens:** Next.js has its own TypeScript configuration expectations that conflict with the monorepo's Node.js-focused base config. The existing `tsconfig.base.json` is designed for pure Node.js packages (no JSX, NodeNext module resolution).

**How to avoid:** The dashboard's `tsconfig.json` should NOT extend `tsconfig.base.json` directly. Instead, it should define its own full configuration compatible with Next.js, or extend only the strict type-checking options. Key settings: `"jsx": "preserve"`, `"module": "ESNext"`, `"moduleResolution": "bundler"`, `"noEmit": true` (Next.js handles compilation), `"paths"` for the `@/` alias.

**Warning signs:** TypeScript errors about JSX, module resolution failures, or `tsc --noEmit` producing different results than `next build`.

### Pitfall 3: Biome Configuration for JSX/TSX Files

**What goes wrong:** Biome linting fails or misses JSX-specific rules because the configuration doesn't account for React patterns.

**Why it happens:** The existing `biome.json` includes `"packages/**/*.tsx"` in the files list, which is good. But the naming conventions (`useNamingConvention`) may need adjustment for React component conventions (PascalCase for components, camelCase for hooks starting with "use").

**How to avoid:** The existing Biome configuration already includes TSX files and allows PascalCase for variables (which covers React components). Test with `pnpm run lint` after creating the first TSX files to verify no unexpected violations. May need a dashboard-specific override in `biome.json` for patterns like `noConsole` in utility scripts or React-specific patterns.

**Warning signs:** Biome errors on valid React patterns like `export default function HomePage()` or `const MyComponent = () => ...`.

### Pitfall 4: Drizzle Schema Import Path Issues

**What goes wrong:** Dashboard can't import schema from `@aesir/agents` because the package's export map doesn't expose the internal `shared/db/schema` path.

**Why it happens:** The `@aesir/agents` package has `"exports": { "./*": { "import": "./dist/*.js" } }` which should map `@aesir/agents/shared/db/schema` to `./dist/shared/db/schema.js`. But Node.js module resolution with `.js` extensions and TypeScript path mapping can be tricky across workspace boundaries.

**How to avoid:** Test the import path early. If it doesn't work, options: (a) add an explicit export entry in `@aesir/agents` for the schema, (b) create a thin schema re-export file in the dashboard, or (c) define standalone read-only table definitions in the dashboard that mirror the existing tables (acceptable for read-only use).

**Warning signs:** TypeScript errors like "Cannot find module '@aesir/agents/shared/db/schema'" or runtime import errors.

### Pitfall 5: pnpm Workspace Resolution in Docker

**What goes wrong:** `pnpm install --frozen-lockfile` fails inside Docker because not all workspace package.json files are present, or workspace protocol references can't be resolved.

**Why it happens:** pnpm needs to see all workspace packages to resolve `workspace:*` references. If you only copy the dashboard's package.json, pnpm can't resolve dependencies on `@aesir/agents`, `@aesir/platform`, etc.

**How to avoid:** Copy ALL package.json files from workspace packages in the Docker build, even for packages the dashboard doesn't directly depend on (pnpm needs the full workspace graph). Follow the existing Dockerfile pattern from the agents service.

**Warning signs:** `ERR_PNPM_OUTDATED_LOCKFILE` or `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND` during Docker build.

### Pitfall 6: Next.js Port Configuration in Docker

**What goes wrong:** Dashboard starts on port 3000 (Next.js default) instead of 3005.

**Why it happens:** Next.js standalone server defaults to port 3000. The PORT environment variable must be set explicitly.

**How to avoid:** Set `ENV PORT=3005` and `ENV HOSTNAME="0.0.0.0"` in the Dockerfile. HOSTNAME must be 0.0.0.0 for Docker networking (default is localhost which doesn't accept external connections inside a container).

**Warning signs:** `curl http://localhost:3005` times out despite the container running, or Docker health check fails.

### Pitfall 7: Nginx basePath Mismatch

**What goes wrong:** Nginx routes `/dashboard/*` to the Next.js service, but Next.js expects requests at `/` (root). CSS, JS, and API calls break because paths don't match.

**Why it happens:** Nginx strips the `/dashboard/` prefix when proxying (or doesn't, depending on configuration), but Next.js isn't configured to serve under a subpath.

**How to avoid:** Configure `basePath: "/dashboard"` in `next.config.ts`. This tells Next.js to serve all pages under `/dashboard/`, matching the Nginx route prefix. All `<Link>` components and `router.push()` calls automatically include the basePath.

**Warning signs:** 404 errors for CSS/JS assets, broken navigation links, or API routes returning 404.

## Code Examples

### Health Check API Route

```typescript
// src/app/api/health/route.ts
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "dashboard",
    timestamp: new Date().toISOString(),
  });
}
```

### Root Layout with Tailwind

```typescript
// src/app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aesir Dashboard",
  description: "Agent execution monitoring and management",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
```

### Placeholder Home Page

```typescript
// src/app/page.tsx
export default function HomePage() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <h1 className="text-2xl font-bold">Aesir Dashboard</h1>
    </main>
  );
}
```

### cn() Utility

```typescript
// src/lib/utils.ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

### Dashboard package.json

```json
{
  "name": "@aesir/dashboard",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev --port 3005",
    "build": "next build",
    "start": "next start --port 3005",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "next": "15.5.9",
    "react": "^19.0.3",
    "react-dom": "^19.0.3",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/postcss": "^4.0.0",
    "drizzle-orm": "^0.45.1",
    "pg": "^8.17.2",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^3.0.0",
    "lucide-react": "^0.400.0",
    "tw-animate-css": "^1.0.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@types/pg": "^8.16.0"
  }
}
```

### Dashboard tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [
      { "name": "next" }
    ],
    "paths": {
      "@/*": ["./src/*"]
    },
    "forceConsistentCasingInFileNames": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true
  },
  "include": ["src/**/*", "next-env.d.ts", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

**Important note on tsconfig.json:** This does NOT extend `tsconfig.base.json` because the base config uses `"module": "NodeNext"` and `"moduleResolution": "NodeNext"` which are incompatible with Next.js. Next.js requires `"module": "ESNext"`, `"moduleResolution": "bundler"`, `"jsx": "preserve"`, and `"noEmit": true`. However, the strict type-checking options (`strict`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUncheckedIndexedAccess`, `forceConsistentCasingInFileNames`) are manually replicated from the base config to maintain consistency across the monorepo.

### Nginx Location Block Addition

```nginx
upstream dashboard {
    server dashboard:3005;
}

# Dashboard
location /dashboard/ {
    proxy_pass http://dashboard/dashboard/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_connect_timeout 5s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;
    proxy_buffering off;
}
```

Note: Because `basePath: "/dashboard"` is set in next.config.ts, the proxy_pass target includes `/dashboard/` to preserve the path prefix. Next.js expects to receive requests at `/dashboard/*`.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `tailwind.config.js` | CSS-first config (`@theme`, `@import "tailwindcss"`) | Tailwind CSS 4.0 (2025) | No config file needed, faster builds, simpler setup |
| `tailwindcss-animate` | `tw-animate-css` | shadcn/ui + Tailwind v4 migration | Must use tw-animate-css with Tailwind v4 |
| HSL color variables | OKLCH color variables | shadcn/ui Tailwind v4 update | Better perceptual uniformity, more predictable color manipulation |
| `next lint` | Direct Biome invocation (`biome check`) | Next.js 15.5 deprecation, 16 removal | Must run linter independently, not via Next.js |
| `middleware.ts` with Edge Runtime | Still `middleware.ts` in Next.js 15 (renamed to `proxy.ts` in 16) | Next.js 16 (Oct 2025) | Staying on 15.5.x means middleware.ts is the correct convention |
| Webpack bundler default | Turbopack default (Next.js 16 only) | Next.js 16 | On 15.5.x, Webpack is still default; Turbopack available but opt-in |

**Deprecated/outdated:**
- `tailwind.config.js` / `tailwind.config.ts`: Not needed with Tailwind v4 CSS-first config
- `tailwindcss-animate`: Replaced by `tw-animate-css` for Tailwind v4
- `next lint`: Deprecated in 15.5, removed in 16
- `experimental.outputFileTracingRoot`: Now a top-level config option (no `experimental` prefix)

## Open Questions

1. **Schema Import Path Verification**
   - What we know: `@aesir/agents` exports `./*` mapping to `./dist/*.js`, which should allow `@aesir/agents/shared/db/schema`
   - What's unclear: Whether this import works correctly across the workspace boundary at build time AND runtime in the standalone Docker output
   - Recommendation: Test early in implementation. If it fails, add an explicit export entry to `@aesir/agents` package.json exports, or define standalone table definitions in the dashboard

2. **Root tsconfig.json References Update**
   - What we know: The root `tsconfig.json` has `references` listing all packages. The dashboard needs to be added.
   - What's unclear: Whether adding a Next.js package (with different compiler options) to the root references causes any issues with the root `pnpm run typecheck`
   - Recommendation: Add the reference. If it causes issues, the dashboard's `"noEmit": true` should prevent conflicts since it doesn't produce build artifacts through tsc

3. **pnpm-workspace.yaml Update**
   - What we know: Current workspace patterns are `packages/*` and `packages/integrations/*`. The dashboard goes in `packages/dashboard/` which is already covered by `packages/*`.
   - What's unclear: Nothing -- this should work without changes
   - Recommendation: No change needed to pnpm-workspace.yaml

4. **Biome Overrides for Dashboard**
   - What we know: The existing biome.json has layer-restriction overrides for packages/platform and packages/integrations. The dashboard may need its own.
   - What's unclear: What import restrictions apply to the dashboard. It needs to import from `@aesir/agents` (for schemas) and `@aesir/platform` (for logging), but should NOT import from integration packages.
   - Recommendation: Add a biome override for `packages/dashboard/**/*.ts` and `packages/dashboard/**/*.tsx` that restricts integration package imports, similar to the existing layer rules

5. **Next.js Standalone and `.next/static` in Docker**
   - What we know: The standalone output doesn't include the `.next/static` directory. It must be copied separately in the Dockerfile.
   - What's unclear: The exact path structure when `outputFileTracingRoot` is set to the monorepo root -- the standalone output mirrors the monorepo directory structure
   - Recommendation: The standalone output will be at `packages/dashboard/.next/standalone/` with the server at `packages/dashboard/.next/standalone/packages/dashboard/server.js`. Copy static files accordingly. Test the Docker build early.

## Sources

### Primary (HIGH confidence)
- Existing codebase analysis: package.json, tsconfig.json, biome.json, docker-compose.yml, Dockerfiles, database schemas, env config patterns -- all verified by direct file inspection
- [Next.js Deploying Documentation](https://nextjs.org/docs/app/getting-started/deploying)
- [Next.js Standalone Output](https://nextjs.org/docs/pages/api-reference/config/next-config-js/output)
- [Tailwind CSS v4 Installation for Next.js](https://tailwindcss.com/docs/guides/nextjs)
- [shadcn/ui Next.js Installation](https://ui.shadcn.com/docs/installation/next)
- [shadcn/ui Manual Installation](https://ui.shadcn.com/docs/installation/manual)
- [shadcn/ui Tailwind v4 Guide](https://ui.shadcn.com/docs/tailwind-v4)

### Secondary (MEDIUM confidence)
- [Next.js 16 Migration Guide](https://nextjs.org/docs/app/guides/upgrading/version-16) -- verified breaking changes vs. Next.js 15
- [Next.js Security Update December 2025](https://nextjs.org/blog/security-update-2025-12-11) -- patched version numbers verified
- [Next.js 15.5 Blog Post](https://nextjs.org/blog/next-15-5) -- deprecation of next lint confirmed
- [Next.js Docker Multi-Stage Pattern (GitHub Discussion)](https://github.com/vercel/next.js/discussions/38435) -- pnpm monorepo Docker patterns
- [Next.js Standalone Monorepo Discussion](https://github.com/vercel/next.js/discussions/35437) -- outputFileTracingRoot necessity confirmed

### Tertiary (LOW confidence)
- [DEV Community: Next.js Standalone with pnpm Workspace in Docker](https://dev.to/singee/fyi-how-to-use-nextjs-standalone-with-pnpm-workspace-in-docker-28m3) -- community pattern, not officially documented
- [Medium: Dockerizing Next.js 15 with pnpm](https://medium.com/@she11fish/dockerizing-next-js-15-application-with-pnpm-for-production-39c841ce8323) -- community pattern

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries verified against official docs, versions cross-referenced with project dependencies and security advisories
- Architecture: HIGH -- patterns derived from existing codebase analysis (Dockerfiles, tsconfig, biome.json, env config) and official Next.js documentation
- Pitfalls: HIGH -- identified from official monorepo discussions, verified against codebase structure
- Docker deployment: MEDIUM -- standalone + pnpm workspace + outputFileTracingRoot combination is well-documented in discussions but the exact Dockerfile needs testing against this specific monorepo
- Drizzle schema imports: MEDIUM -- the export map suggests it should work but cross-workspace imports need runtime verification

**Research date:** 2026-02-04
**Valid until:** 2026-03-06 (30 days -- stack is stable, Next.js 15.5.x is in maintenance mode)

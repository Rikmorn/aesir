---
phase: 49-dashboard-infrastructure
plan: 01
subsystem: ui
tags: [next.js, tailwind-css-4, shadcn-ui, react, typescript, dashboard]

# Dependency graph
requires:
  - phase: 48-agent-service-api
    provides: Agent service API endpoints for dashboard to consume
provides:
  - "@aesir/dashboard pnpm workspace package with Next.js 15.5.9"
  - "Tailwind CSS 4 + shadcn/ui oklch CSS variable system"
  - "Health check at /api/health"
  - "Auth-ready middleware passthrough"
  - "cn() utility for class merging"
  - "Biome overrides for dashboard TSX/API route naming conventions"
  - "Root tsconfig.json project reference for dashboard"
affects: [49-02-drizzle-service-layer, 49-03-docker-compose, 50-conversation-views, 51-agent-views]

# Tech tracking
tech-stack:
  added: [next@15.5.9, react@19, tailwindcss@4, @tailwindcss/postcss@4, class-variance-authority, clsx, tailwind-merge, lucide-react, tw-animate-css]
  patterns: [Next.js App Router, standalone output with outputFileTracingRoot, basePath for sub-path routing, CSS-first Tailwind v4 config, oklch color variables]

key-files:
  created:
    - packages/dashboard/package.json
    - packages/dashboard/tsconfig.json
    - packages/dashboard/next.config.ts
    - packages/dashboard/postcss.config.mjs
    - packages/dashboard/components.json
    - packages/dashboard/.gitignore
    - packages/dashboard/public/.gitkeep
    - packages/dashboard/src/app/layout.tsx
    - packages/dashboard/src/app/page.tsx
    - packages/dashboard/src/app/globals.css
    - packages/dashboard/src/app/api/health/route.ts
    - packages/dashboard/src/middleware.ts
    - packages/dashboard/src/lib/utils.ts
  modified:
    - tsconfig.json
    - biome.json
    - pnpm-lock.yaml

key-decisions:
  - "Dashboard tsconfig.json does NOT extend tsconfig.base.json (incompatible module/moduleResolution for Next.js)"
  - "Biome override for TSX files allows PascalCase function names (React components)"
  - "Biome override for API route files allows CONSTANT_CASE function names (GET, POST, etc.)"
  - "basePath set to /dashboard for Nginx sub-path routing"
  - "Minimal layout.tsx and page.tsx included in Task 1 commit (pre-commit hook runs next build)"

patterns-established:
  - "Dashboard tsconfig: standalone config with bundler moduleResolution, jsx preserve, noEmit true"
  - "Next.js standalone output with outputFileTracingRoot pointing to monorepo root"
  - "Tailwind CSS 4 zero-config: @import tailwindcss in CSS, @tailwindcss/postcss in PostCSS"
  - "shadcn/ui oklch color variables in globals.css with @theme inline mapping"
  - "Biome API route override pattern for Next.js CONSTANT_CASE HTTP method exports"

# Metrics
duration: 7min
completed: 2026-02-04
---

# Phase 49 Plan 01: Next.js Dashboard Package Summary

**Next.js 15.5.9 App Router with Tailwind CSS 4 oklch theme, shadcn/ui setup, health endpoint, and auth-ready middleware in `@aesir/dashboard` workspace package**

## Performance

- **Duration:** 7 min
- **Started:** 2026-02-04T13:30:19Z
- **Completed:** 2026-02-04T13:37:19Z
- **Tasks:** 2
- **Files modified:** 16 (13 created, 3 modified)

## Accomplishments

- Created `@aesir/dashboard` as a valid pnpm workspace package with Next.js 15.5.9
- Configured Tailwind CSS 4 with full shadcn/ui oklch color variable system (light + dark themes)
- Health check endpoint at `/api/health` returns JSON with status, service name, and timestamp
- Auth-ready middleware passthrough that can be extended with session checks later
- Biome linting configured with dashboard-specific overrides for React and Next.js conventions
- Root tsconfig.json updated with dashboard project reference
- All typecheck and lint checks pass with zero errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Create dashboard package configuration files** - `eb34e98` (feat)
2. **Task 2: Create app files, middleware, and update root configs** - `965620e` (feat)

## Files Created/Modified

- `packages/dashboard/package.json` - @aesir/dashboard workspace package definition
- `packages/dashboard/tsconfig.json` - Next.js-compatible TypeScript config (standalone, not extending base)
- `packages/dashboard/next.config.ts` - Standalone output, outputFileTracingRoot, basePath /dashboard
- `packages/dashboard/postcss.config.mjs` - @tailwindcss/postcss plugin for Tailwind CSS 4
- `packages/dashboard/components.json` - shadcn/ui CLI configuration (new-york style, zinc base)
- `packages/dashboard/.gitignore` - Ignores .next/, out/, node_modules/, next-env.d.ts
- `packages/dashboard/public/.gitkeep` - Empty public dir for Docker COPY compatibility
- `packages/dashboard/src/app/layout.tsx` - Root layout with metadata and Tailwind body classes
- `packages/dashboard/src/app/page.tsx` - Placeholder home page with centered heading
- `packages/dashboard/src/app/globals.css` - Tailwind imports + full shadcn/ui oklch CSS variables
- `packages/dashboard/src/app/api/health/route.ts` - Health check GET endpoint
- `packages/dashboard/src/middleware.ts` - Auth-ready passthrough middleware
- `packages/dashboard/src/lib/utils.ts` - cn() utility (clsx + tailwind-merge)
- `tsconfig.json` - Added dashboard to project references
- `biome.json` - Added dashboard import restrictions, TSX naming, and API route naming overrides
- `pnpm-lock.yaml` - Updated with dashboard dependencies

## Decisions Made

- **Dashboard tsconfig is standalone:** Does NOT extend `tsconfig.base.json` because the base uses `"module": "NodeNext"` and `"moduleResolution": "NodeNext"` which are incompatible with Next.js's required `"module": "ESNext"` and `"moduleResolution": "bundler"`. Strict options are manually replicated.
- **Biome TSX override for PascalCase functions:** React components export PascalCase function names (`RootLayout`, `HomePage`) which conflicts with the global camelCase-only function rule. Added a TSX-specific override.
- **Biome API route override for CONSTANT_CASE functions:** Next.js API routes require uppercase HTTP method exports (`GET`, `POST`). Added a route-file-specific override.
- **basePath /dashboard:** Configured for Nginx sub-path routing so the dashboard can be accessed at `/dashboard/` behind a reverse proxy.
- **Minimal app files in Task 1:** Pre-commit hook runs `pnpm -r run build` which requires at least one page. Added minimal layout.tsx and page.tsx in Task 1 to pass the build check.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Minimal app files required in Task 1 for pre-commit hook**
- **Found during:** Task 1 (commit attempt)
- **Issue:** Pre-commit hook runs `pnpm -r run build` which triggers `next build` for the dashboard. Without `src/app/page.tsx` and `src/app/layout.tsx`, the build fails with "Couldn't find any pages or app directory".
- **Fix:** Created minimal layout.tsx and page.tsx in Task 1 (later replaced with full versions in Task 2)
- **Files modified:** packages/dashboard/src/app/layout.tsx, packages/dashboard/src/app/page.tsx
- **Verification:** Build passes in pre-commit hook
- **Committed in:** eb34e98 (Task 1 commit)

**2. [Rule 3 - Blocking] Biome overrides pulled forward from Task 2 to Task 1**
- **Found during:** Task 1 (commit attempt)
- **Issue:** TSX files fail Biome lint because PascalCase function names are not allowed in the global config. The biome.json override was originally planned for Task 2.
- **Fix:** Added all biome.json overrides (TSX naming, dashboard import restrictions) in Task 1
- **Files modified:** biome.json
- **Verification:** `npx biome check packages/dashboard/` passes with 0 errors
- **Committed in:** eb34e98 (Task 1 commit)

**3. [Rule 3 - Blocking] Added Biome override for Next.js API route CONSTANT_CASE functions**
- **Found during:** Task 2 (biome check)
- **Issue:** Next.js API route handlers must be named `GET`, `POST`, etc. (CONSTANT_CASE). The global Biome config only allows camelCase for functions.
- **Fix:** Added a biome override for `packages/dashboard/**/app/api/**/route.ts` allowing CONSTANT_CASE function names
- **Files modified:** biome.json
- **Verification:** `npx biome check packages/dashboard/src/app/api/health/route.ts` passes
- **Committed in:** 965620e (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (3 blocking)
**Impact on plan:** All fixes were necessary for the pre-commit hook to pass. No scope creep -- just reordering when biome overrides were applied and accommodating the build hook's requirement for app files.

## Issues Encountered

- Pre-commit hook runs `pnpm -r run build` across all packages, which means the dashboard must be buildable at every commit point. This required including minimal app files and biome overrides in Task 1 rather than Task 2 as originally planned.
- `__dirname` variable name violates Biome naming conventions. Renamed to `currentDir` in next.config.ts.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Dashboard package is fully configured and building
- Ready for Plan 02 (Drizzle read-only database client and service layer)
- Ready for Plan 03 (Docker Compose service and Dockerfile)
- shadcn/ui components can be added via `npx shadcn@latest add` using the components.json config
- No blockers

---
*Phase: 49-dashboard-infrastructure*
*Completed: 2026-02-04*

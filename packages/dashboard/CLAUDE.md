# packages/dashboard

Next.js 15 operations dashboard (App Router, `basePath=/dashboard`, port 3005, standalone output). Read this before touching anything here; the project-wide rules are in the root `AGENTS.md`.

## Design system

The design tokens (colour, typography, spacing, radii) are the `@theme inline` block in `src/app/globals.css`, and the component primitives are the shadcn `new-york` set under `src/components/ui/`. Read both before creating or changing UI, and extend the tokens rather than hard-coding values in a component.

## Skills in this package

`impeccable` (UI critique and polish), `shadcn` (component library conventions) and `vercel-react-best-practices` (Vercel's React guidance) are installed under `.claude/skills/` here. They load for a session started in this directory, and for a session started at the repo root once it reads a file in this package (measured 2026-09-16, Claude Code 2.1.273). The `shadcn` skill injects `npx shadcn@latest info --json` inline as it loads; that command succeeds only with `packages/dashboard` as the working directory and exits 1 from the repo root. They are third-party and overwritten on update: never edit them in place; scoping notes go in this file.

## Patterns that bite

- The dashboard has a local schema (`src/lib/schema.ts`) and never imports `@aesir/agents`; keep it that way to keep the Next.js dependency tree small.
- Server/client boundary: `Date` objects are serialised to ISO strings before crossing into client components; typed serialised interfaces at the boundary.
- No pino here; `console.error` needs a `biome-ignore` comment with the reason.
- SSE arrives through the proxy route at `/dashboard/api/sse/events`; `EventStreamStore` is a plain class, importable from server and client.
- Verify visually: `pnpm --filter @aesir/dashboard dev`, then the page in a browser. Typecheck is not a rendering check.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

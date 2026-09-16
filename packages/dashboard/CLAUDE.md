# packages/dashboard

Next.js 15 operations dashboard (App Router, `basePath=/dashboard`, port 3005, standalone output). Read this before touching anything here; the project-wide rules are in the root `AGENTS.md`.

## Design system

Every visual decision traces back to `.interface-design/system.md` at the repo root: colour tokens, typography, spacing, depth, status indicators, component patterns. Read it before creating or changing UI.

## Skills in this package

`impeccable` (UI critique and polish), `shadcn` (component library conventions) and `vercel-react-best-practices` (Vercel's React guidance) are installed under `.claude/skills/` here and load when a session starts in this directory. They are third-party and overwritten on update: never edit them in place; scoping notes go in this file.

## Patterns that bite

- The dashboard has a local schema (`src/lib/schema.ts`) and never imports `@aesir/agents`; keep it that way to keep the Next.js dependency tree small.
- Server/client boundary: `Date` objects are serialised to ISO strings before crossing into client components; typed serialised interfaces at the boundary.
- No pino here; `console.error` needs a `biome-ignore` comment with the reason.
- SSE arrives through the proxy route at `/dashboard/api/sse/events`; `EventStreamStore` is a plain class, importable from server and client.
- Verify visually: `pnpm --filter @aesir/dashboard dev`, then the page in a browser. Typecheck is not a rendering check.

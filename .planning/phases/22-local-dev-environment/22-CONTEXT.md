# Phase 22: Local Dev Environment - Context

**Gathered:** 2026-01-23
**Status:** Ready for planning

<domain>
## Phase Boundary

One-command local development with fast iteration and proper shutdown handling. Running `docker compose up` starts all services ready to use. Code changes can optionally trigger automatic rebuild via hot reload.

</domain>

<decisions>
## Implementation Decisions

### Service Composition
- All agents start by default (dev-agent and product-agent)
- All integration HTTP services start automatically (Linear:3001, GitHub:3002, Slack:3003)
- Infrastructure: PostgreSQL + Temporal (required before agents/integrations)
- Single `docker compose up` starts the complete system

### Hot Reload
- Triggers: TypeScript source files + config files (package.json, tsconfig, .env)
- Mechanism: Docker Compose watch (`docker compose watch` / develop.watch config)
- Toggle: Profile-based — `docker compose up` (no watch) vs `docker compose --profile watch up` (with watch)
- Default: No hot reload (stable, predictable); opt-in via profile

### Claude's Discretion
- Health check implementation details (what checks pass/fail, intervals, retries)
- Graceful shutdown behavior (drain timeout, what constitutes "in-flight work")
- Which services can safely hot reload (Temporal workers have special constraints)
- Startup ordering and dependency configuration (depends_on, healthcheck conditions)

</decisions>

<specifics>
## Specific Ideas

- Hot reload should be toggleable because it can be "heavy and disruptive" during certain tasks
- When hot reload is off, run commands manually for full control
- System should work end-to-end locally — this is the primary validation method for v2.0

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 22-local-dev-environment*
*Context gathered: 2026-01-23*

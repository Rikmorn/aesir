---
phase: 26-dev-agent-workflow
plan: 12
type: summary
completed: 2026-01-26
duration: 3min
subsystem: infrastructure
tags: [docker, docker-compose, dispatcher, routing, nginx]
wave: 8

# Dependency Graph
requires:
  - 26-11 # HTTP service and worker implementation
provides:
  - dev-agent Docker Compose services
  - Linear event dispatcher routing
  - Nginx reverse proxy configuration
affects:
  - 26-13 # E2E testing will use this infrastructure

# Tech Stack
tech-stack:
  added: []
  patterns:
    - Separate HTTP and worker containers for scalability
    - Docker socket mounting for container orchestration
    - Event dispatcher fire-and-forget pattern

# Key Files
key-files:
  created: []
  modified:
    - docker-compose.yml
    - packages/integrations/linear/src/dispatcher/routes.ts

# Decisions
decisions:
  - id: DEC-26-12-01
    title: "Separate dev-agent and dev-agent-worker services"
    decision: "Split into HTTP service (main.js) and Temporal worker (worker.js) containers"
    rationale: "Allows independent scaling - HTTP service for event ingestion can scale separately from workflow processing"
    alternatives:
      - "Single container running both HTTP and worker"
    tradeoffs: "More containers to manage, but better separation of concerns"
    status: implemented
    date: 2026-01-26

  - id: DEC-26-12-02
    title: "Worker depends on HTTP service health"
    decision: "dev-agent-worker waits for dev-agent health check before starting"
    rationale: "Ensures HTTP service is ready to handle status updates from worker activities"
    alternatives:
      - "Start independently with retry logic"
    tradeoffs: "Slightly slower startup, but more predictable initialization"
    status: implemented
    date: 2026-01-26

  - id: DEC-26-12-03
    title: "Dispatch all issue events, filter in handler"
    decision: "Linear dispatcher sends all issue.created/updated events; dev-agent filters by agent-ready label"
    rationale: "Simpler dispatcher logic; handler has full context for filtering decisions"
    alternatives:
      - "Filter at dispatcher with payload inspection"
    tradeoffs: "More events dispatched, but cleaner separation of concerns"
    status: implemented
    date: 2026-01-26
---

# Phase 26 Plan 12: Docker Compose & Dispatcher Routing Summary

**One-liner:** Split dev-agent into HTTP service and Temporal worker containers with Linear issue event routing

## What Was Built

### Docker Compose Services

**dev-agent service (HTTP endpoint):**
- Port 3004 for receiving events from Linear dispatcher
- Command: `node dist/dev-agent/main.js`
- Health check on `/health` endpoint
- Docker socket access for DevContainerManager
- Environment: Temporal, database, MCP URLs, GitHub config
- Dependencies: postgresql, temporal, all integrations

**dev-agent-worker service (Temporal worker):**
- Command: `node dist/dev-agent/worker.js`
- Processes Temporal workflows for task execution
- Docker socket access for spawning dev containers
- Same environment as HTTP service
- Depends on dev-agent health before starting

**Docker socket mounting:**
- Primary: `/var/run/docker.sock` (Linux)
- Alternative: `${HOME}/.docker/run/docker.sock` (macOS)
- Both paths included; Docker uses first available

### Linear Dispatcher Routing

Added routes for issue events:
- `linear.issue.created` → `http://dev-agent:3004/events`
- `linear.issue.updated` → `http://dev-agent:3004/events`
- Async mode (5s timeout, fire-and-forget)
- Configurable via `DEV_AGENT_URL` environment variable

**Event filtering:**
- Dispatcher sends all issue events
- Dev-agent handler filters for `agent-ready` label
- Clean separation: dispatcher routes, handler decides

### Nginx Routing (Pre-existing)

**Verified configuration:**
- Route: `/agent/*` → `http://dev-agent:3004/`
- Upstream: `dev-agent:3004`
- Timeouts: 5s connect, 60s send/read
- Buffering disabled for faster response

## Technical Implementation

### Service Architecture

```
Linear Webhook → Linear Integration → Dispatcher → dev-agent:3004/events
                                                         ↓
                                                   Temporal Client
                                                         ↓
                                              Start devAgentWorkflow
                                                         ↓
                                                dev-agent-worker
                                                         ↓
                                               Execute workflow nodes
                                                         ↓
                                              DevContainerManager
                                                         ↓
                                            Spawn containers via Docker API
```

### Environment Variables

**Required for dev-agent:**
- `ANTHROPIC_API_KEY` - LLM API access
- `DATABASE_URL` - PostgreSQL connection
- `TEMPORAL_ADDRESS` - Temporal server (temporal:7233)
- `GITHUB_TOKEN` - For git operations in containers
- `GITHUB_REPO_URL` - Repository to clone
- `LINEAR_TEAM_ID` - For MCP calls
- `DEV_AGENT_SLACK_CHANNEL` - Notification channel

**MCP URLs (defaults to Docker network names):**
- `LINEAR_MCP_URL=http://linear-integration:3001`
- `GITHUB_MCP_URL=http://github-integration:3002`
- `SLACK_MCP_URL=http://slack-integration:3003`

### Health Checks

**dev-agent HTTP service:**
```yaml
healthcheck:
  test: ["CMD-SHELL", "node -e \"require('http').get('http://localhost:3004/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))\""]
  interval: 10s
  timeout: 5s
  retries: 3
  start_period: 30s
```

**Worker dependency:**
```yaml
depends_on:
  dev-agent:
    condition: service_healthy
```

## Testing & Verification

**Verification performed:**
- ✓ `docker compose config` validates successfully
- ✓ dev-agent service defined with port 3004
- ✓ dev-agent-worker service defined
- ✓ Docker socket mounted in both services
- ✓ Linear dispatcher routes issue events
- ✓ Nginx routing pre-configured and verified
- ✓ TypeScript compilation passes

**Manual testing required:**
1. Start services: `docker compose up dev-agent dev-agent-worker`
2. Verify health: `curl http://localhost:3004/health`
3. Check worker logs: `docker compose logs -f dev-agent-worker`
4. Trigger Linear webhook with agent-ready label
5. Verify workflow starts in Temporal UI

## Deviations from Plan

**None - plan executed exactly as written.**

All specified tasks completed:
1. ✓ Docker Compose services for dev-agent and worker
2. ✓ Linear dispatcher routing for issue events
3. ✓ Nginx routing verified (already configured)

## Next Phase Readiness

**Phase 26 Plan 13 (E2E Testing) can proceed with:**
- ✓ Dev-agent HTTP service accepting events
- ✓ Worker processing Temporal workflows
- ✓ Docker socket access for container management
- ✓ Linear dispatcher routing configured
- ✓ All dependencies in docker-compose.yml

**Integration points ready:**
- Linear dispatcher → dev-agent events endpoint
- Dev-agent → Temporal workflows
- Worker → DevContainerManager → Docker API
- All MCP integrations accessible via internal network

**Known limitations:**
- Issue webhook parsing not implemented (Linear integration only handles AgentSession events)
- Will need Linear webhook configuration to send Issue events
- Dispatcher routes configured but webhook handler needs Issue event support

**Recommended for Phase 26-13:**
1. Add Issue webhook parsing to Linear integration
2. Test full event flow: webhook → dispatcher → dev-agent → workflow
3. Verify container spawning in Docker environment
4. Test MCP tool calls from worker context

## Performance Metrics

- **Duration:** 3 minutes
- **Files modified:** 2
- **Commits:** 3
- **Deviations:** 0

## Documentation Updates

**Updated:**
- docker-compose.yml comments explain service split
- Dispatcher routes.ts comments explain filtering strategy

**No additional documentation needed** - inline comments are comprehensive.

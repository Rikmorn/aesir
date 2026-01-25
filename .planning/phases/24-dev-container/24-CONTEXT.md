# Phase 24: Dev Container - Context

**Gathered:** 2026-01-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Dev-agent can spawn persistent containers, execute shell commands, and manage container lifecycle. This is infrastructure that enables dev-agent to work like a developer with shell access to a cloned repository.

**From existing spec (.planning/2.1-rob-context.md):**
- Container image: Node.js, pnpm, git, ripgrep, fd, jq, GitHub CLI (gh)
- Container naming: `dev-container-{taskId}`
- Repository setup: Clone to `/workspace/repo`, branch `feature/{issueId}`, run `pnpm install`
- Work in container: research (rg, cat, find), write files (cat > file), test, commit, push

</domain>

<decisions>
## Implementation Decisions

### Error Handling

- **Command timeout:** Kill command, mark task as failed, notify Slack, cleanup container (no retry)
- **Timeout values:** Per-command timeouts based on operation type:
  - Research commands (grep, cat, find): short timeout
  - Install/test commands: longer timeout
  - Claude determines specific values during implementation
- **Container crash recovery:** If container dies mid-task, spawn new container, clone repo, checkout same branch, pull from origin, resume from last commit. Branch is the state — committed work survives.
- **Test failure retries:** Claude's discretion on retry count based on error type

### Container State Management

- **Database-first tracking:** Container state stored in database (production-ready approach)
- **Sync with Docker:** Verify actual container existence via Docker API on every operation
- **Metadata stored:** container_id, task_id, status (running/stopped/failed), created_at, last_activity
- **Why database-first:** Enables future multi-host, Kubernetes, and audit trail without architecture change

### Container Lifecycle

- **One container per task:** Named `dev-container-{taskId}` for 1:1 mapping
- **Reuse for feedback:** Same container used when PR feedback arrives (container persists)
- **Discovery:** Query database by taskId, verify container exists via Docker API

### Cleanup Triggers

Three triggers cause container cleanup:
1. **PR merged:** Task complete, cleanup immediately
2. **PR closed (without merge):** Work abandoned, cleanup
3. **24h inactivity:** No commands executed in 24 hours

**Not implemented in v2.1:** Explicit cleanup API (manual cleanup via Docker commands if needed)

### GitHub Authentication

- **Injection method:** Environment variable (GITHUB_TOKEN passed to container at spawn)
- **Token source:** Fetch from `github.credentials` table (same encrypted storage as GitHub integration)
- **Git credential helper:** Configure in container to read token from env for HTTPS operations

### Claude's Discretion

- Specific timeout values for each command category
- Test failure retry count
- Container resource limits (memory/CPU) — not a priority for v2.1
- Network isolation policy — not restricted for v2.1

</decisions>

<specifics>
## Specific Ideas

From existing spec (.planning/2.1-rob-context.md):

- "Works in a real environment (not API calls per file)"
- "Explores codebase naturally (grep, find, ripgrep)"
- "Runs tests as it goes (fast feedback)"
- "Commits incrementally (good git history)"
- "Container persists for feedback loop"

Branch pattern `feature/{issueId}` means the branch IS the state:
- Committed work survives container death
- Resume from branch is straightforward (clone → checkout → pull → continue)
- Dedicated branch per task makes conflict-free

</specifics>

<deferred>
## Deferred Ideas

- **Resource limits:** Memory/CPU caps for containers — defer to later when scaling concerns arise
- **Network isolation:** Container network policy — not restricted for v2.1
- **Explicit cleanup API:** Manual cleanup endpoint — can use Docker commands directly for now
- **Multi-host containers:** Current implementation assumes local Docker socket — database-first tracking prepares for future multi-host

</deferred>

---

*Phase: 24-dev-container*
*Context gathered: 2026-01-25*

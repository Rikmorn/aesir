# Phase 84: Scheduled Execution - Context

**Gathered:** 2026-02-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Agents can run on cron schedules for periodic work (backlog grooming, monitoring), breaking the purely reactive event-driven model. Covers schedule declaration in YAML, pg-boss cron registration, synthetic event creation, overlap prevention, manual triggers, and dashboard visibility. Does NOT include agent-monitoring-agent capabilities, streak/pattern detection, or scheduled task parameterization beyond prompt guidance.

</domain>

<decisions>
## Implementation Decisions

### YAML schedule declaration
- Dedicated top-level `schedules` section in definition.yaml, separate from `triggers`
- Schema: `name` (string, required, unique within agent), `cron` (string, required, standard 5-field), `timezone` (string, optional, default UTC)
- No `overlap` field -- only skip behavior is supported (queue policy dropped, see below)
- Multiple schedules per agent supported (e.g., product-agent: weekly-grooming + daily-triage)
- Schedule `name` is the identity -- used in pg-boss job naming, correlationKey, dashboard display, and prompt-level branching

### Schedule context injection
- Fields: schedule name, last run timestamp, time since last run, last run outcome (terminal status + final assistant message from previous conversation), run count
- Format: structured XML block in the initial message (same pattern as delegation context blocks), not system prompt modification
- Final assistant message from previous conversation serves as natural summary -- no separate summarization step
- No full conversation history, tool call details, or identity documents (knowledge system and Phase 86 handle cross-session persistence)
- No custom parameters -- the agent's system prompt defines what to do, schedule name differentiates when an agent has multiple schedules

### Event routing path
- Scheduled runs go through EventRouter (not direct ConversationExecutor.start())
- Synthetic event type: `schedule.triggered`, source: `scheduler`
- CorrelationKey: `${agentId}:${scheduleName}` -- deterministic, enables start() idempotency
- Event data payload: `{ agentId, scheduleName, cron, lastRunAt, lastRunOutcome, lastRunOutcomeSummary, runCount, trigger: "scheduled" | "manual" }`
- Deduplication handled by EventRouter + start() idempotency -- pg-boss double-fires are no-ops

### Overlap policy
- Only `skip` behavior -- no `queue` policy
- When a schedule fires and a previous run is still active, the new run is skipped
- Skipped runs are logged as events (for dashboard history) but do not trigger failure notifications
- Dashboard distinguishes "Skipped -- previous run still active" from "Missed -- no run detected"
- Queue policy dropped: cascading backlog risk, stale context, no real use case, skip + manual force trigger covers the need

### Startup and registration
- Re-register all schedules on every worker startup -- pg-boss schedule() is idempotent
- YAML definitions are the authoritative registry, pg-boss is the execution engine
- Reconcile on startup: register everything from definitions, unregister pg-boss jobs that no longer match any definition
- Definition changes (cron expression, timezone) take effect on restart
- Mid-flight restart: existing heartbeat/claim mechanism handles in-progress conversations

### Dashboard presentation
- No dedicated schedules page -- schedules live as a section within the Agents pages
- Agent list page: badge/indicator on agents with schedules (clock icon or "N schedules" chip)
- Agent detail page: schedules section showing per-schedule: name, human-readable cron ("Every Monday at 9am UTC"), next run time, last run status/timestamp, manual trigger button
- Run history: last 5 runs inline (status chip, timestamp, duration, conversation link) + "View all" link to conversations page filtered by schedule correlationKey
- No separate run history storage -- schedule runs ARE conversations, queried by correlationKey
- Lightweight schedule state cached (lastRunAt, lastRunOutcome, lastRunConversationId) for SCH-06 context injection without querying conversations
- Overview page: "Upcoming Schedules" card showing next 3-5 scheduled runs across all agents, sorted by time

### Schedule health indicators
- Three derived states, no new health infrastructure:
  - Healthy -- last run completed, next run scheduled (neutral styling)
  - Failed -- last run ended in failed/cancelled status (warning indicator)
  - Missed -- next run time passed without a conversation being created (error indicator)
- "Skipped" is distinct from "Missed" -- skip is policy working as intended, not an error
- All states derived from existing conversation data + pg-boss job metadata

### Manual trigger
- Immediate fire, no confirmation dialog -- low blast radius (just starts a conversation)
- API endpoint: `POST /api/schedules/:agentId/:scheduleName/trigger` with `{ force?: boolean }` body
- Dashboard button calls the API -- API is the primary interface
- Default respects skip policy -- if previous run active, skip with toast notification
- Skip toast includes "Force run" action as secondary escalation
- Force run uses distinct correlationKey (timestamp suffix) to bypass idempotency
- Manual runs get `trigger: "manual"` field on synthetic event -- dashboard renders "Manual" badge
- Enables automation: CI pipelines, monitoring alerts, Slack bots can trigger schedules via API

### Failure and recovery
- Next run proceeds normally with `lastRunOutcome: "failed"` context -- agent reasons about it
- No circuit breaker, no automatic schedule suspension, no retry semantics
- Existing v2.8 failure notifications cover scheduled conversations automatically (a failed scheduled run is a failed conversation)
- Skipped runs do not trigger failure notifications -- they're logged as events for dashboard visibility
- Prompt guidance teaches agents to consider previous failure context when relevant

### Claude's Discretion
- pg-boss job naming convention and internal implementation details
- Exact cron parsing/validation library choice
- Schedule state storage mechanism (pg-boss job metadata vs lightweight DB record)
- Dashboard component layout and spacing within the schedules section
- Human-readable cron expression formatting approach
- Toast notification styling and timing

</decisions>

<specifics>
## Specific Ideas

- "Schedules are a property of agents, not a standalone concept" -- operator mental model is "what does this agent do and when does it run?"
- Schedule follows the same pattern as AgentRegistry -- definitions are authoritative, runtime state is derived
- Schedule context injection follows the same pattern as delegation context blocks -- structured XML in initial message
- Manual trigger follows CI/CD precedent (GitHub Actions "Run workflow", Jenkins "Build Now") -- immediate fire, no friction
- "If a scheduled task is so important that missing a run is unacceptable, the fix is making the task faster or running it more frequently -- not queuing stale runs"

</specifics>

<deferred>
## Deferred Ideas

- Queue overlap policy -- dropped from this phase; can be reconsidered if a concrete use case emerges
- Schedule-specific alerting (e.g., "Schedule X has failed 3 times in a row") -- v3.0 territory when agents monitor other agents
- Parameterized schedules (custom context passed per-schedule) -- backward-compatible to add later, no use case yet
- Calendar/timeline view of schedules -- speculative complexity for 10-20 schedules
- Circuit breaker / automatic suspension after N failures -- creates invisible operational gaps

</deferred>

---

*Phase: 84-scheduled-execution*
*Context gathered: 2026-02-22*

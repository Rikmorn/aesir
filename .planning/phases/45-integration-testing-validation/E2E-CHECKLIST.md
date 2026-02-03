# Phase 45: Manual E2E Validation Checklist

Manual end-to-end validation for the v2.3 unified agent framework.
Run after automated integration tests pass. Tests real webhook delivery,
Docker networking, and agent behavior with real LLM calls.

## Prerequisites

- [ ] Docker Compose running: `docker compose up -d`
- [ ] Migrations applied: `pnpm db:migrate`
- [ ] MCP permissions seeded for all integrations:
  - `pnpm --filter @aesir/integration-linear seed:permissions`
  - `pnpm --filter @aesir/integration-github seed:permissions`
  - `pnpm --filter @aesir/integration-slack seed:permissions`
- [ ] Cloudflare tunnel (or ngrok) exposing local ports for webhook delivery
- [ ] Valid API keys in `.env` (ANTHROPIC_API_KEY, integration tokens)
- [ ] Integration tests pass: `npx vitest run -c vitest.integration.config.ts packages/agents/src/framework/__integration__/`

## Known Limitations (Phase 45)

- Temporal code is still on disk (Phase 47 cleanup)
- Legacy database tables (`tasks`, `context_snapshots`, `execution_traces`) still exist
- Feature flag (`USE_V23_EXECUTOR`) not implemented yet -- v2.3 is the only active path
- Old per-agent services (`dev-agent:3004`, `product-agent:3005`) are removed from Docker Compose
- Timeout scheduler (pg-boss) requires its own schema -- verify `pgboss` schema exists after migrations

## What Changed in v2.3

| Before (v2.2) | Now (v2.3) |
|---------------|------------|
| 3 separate agent services + router | 1 unified agent-service on port 3004 |
| Temporal workflows orchestrate agents | ConversationExecutor with PostgreSQL SKIP LOCKED |
| Per-agent `main.ts` entry points | Single `service/main.ts` |
| Temporal UI at `:8080` for workflow inspection | `GET /conversations/:id` for status |
| Signal via Temporal `workflowClient.signal()` | Signal via `POST /events` or `executor.signal()` |
| Agent definitions in TypeScript code | Agent definitions in YAML (`definitions/`) |
| Tool factories registered in agent code | ToolRegistry with `namespace:tool_name` refs |

## Flow 1: Dev Agent -- Linear Issue to PR

### 1.1 Trigger

1. [ ] Create a Linear issue in the configured team (LINEAR_TEAM_ID)
2. [ ] Assign the "agent-ready" label or trigger the `agent_session.created` webhook
3. [ ] If no webhook configured, manually POST to agent-service:
   ```bash
   curl -X POST http://localhost:3004/events \
     -H 'Content-Type: application/json' \
     -d '{
       "id": "evt_manual001",
       "type": "linear.agent_session.created",
       "source": "linear",
       "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
       "correlationId": "manual-test-001",
       "payload": {
         "issueId": "YOUR-ISSUE-ID",
         "issueIdentifier": "YOUR-ISSUE-ID"
       }
     }'
   ```

### 1.2 Verify Start

4. [ ] Check agent-service logs: `docker compose logs -f agent-service`
   - Expected: `"Routing event"`, `"Started new conversation"`
   - Note the conversation ID (format: `dev-agent-{issueId}`)
5. [ ] Verify conversation exists:
   ```bash
   curl http://localhost:3004/conversations/dev-agent-YOUR-ISSUE-ID | jq .
   ```
   - Expected: JSON with `status: "queued"` or `status: "running"`

### 1.3 Verify Execution

6. [ ] Watch logs for agent loop execution:
   - Expected: `"Claimed conversation"`, tool calls (`read_file`, `create_branch`, etc.)
7. [ ] Agent should pause for approval (`wait_for` with type `"approval"`)
   - Expected: `status` changes to `"waiting"` in `GET /conversations/:id`
8. [ ] Verify event log has recorded events:
   - Expected: `agent.started`, `tool.called`, `tool.succeeded` events

### 1.4 Verify Approval Signal

9. [ ] Approve via Slack button (if Slack integration configured)
10. [ ] Or send manual approval signal:
    ```bash
    curl -X POST http://localhost:3004/events \
      -H 'Content-Type: application/json' \
      -d '{
        "id": "evt_approve001",
        "type": "slack.block_actions.approved",
        "source": "slack",
        "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
        "correlationId": "manual-approve-001",
        "payload": {
          "taskIdentifier": "YOUR-ISSUE-ID",
          "approved": true,
          "userId": "U_MANUAL"
        }
      }'
    ```
11. [ ] Verify conversation resumed:
    ```bash
    curl http://localhost:3004/conversations/dev-agent-YOUR-ISSUE-ID | jq .status
    ```
    - Expected: `"running"` then `"completed"`

### 1.5 Verify Artifacts

12. [ ] Check GitHub for created branch and PR
13. [ ] Check Linear issue for status update / comment from agent
14. [ ] Verify final conversation status is `"completed"`

## Flow 2: Product Agent -- Slack Message to Linear Issue

### 2.1 Trigger

1. [ ] Send a message mentioning `@aesir` in a configured Slack channel:
   - Example: `@aesir create a user authentication feature with JWT tokens`
2. [ ] Or manually POST the normalized event:
   ```bash
   curl -X POST http://localhost:3004/events \
     -H 'Content-Type: application/json' \
     -d '{
       "id": "evt_slack001",
       "type": "slack.app_mention.created",
       "source": "slack",
       "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
       "correlationId": "manual-slack-001",
       "payload": {
         "text": "Create a user authentication feature with JWT tokens",
         "channel": "YOUR-CHANNEL-ID",
         "user": "U_TEST",
         "ts": "1700000000.000001",
         "threadTs": null
       }
     }'
   ```

### 2.2 Verify Start

3. [ ] Check agent-service logs for conversation creation:
   - Expected: `"Started new conversation"` with product-agent prefix
4. [ ] Verify conversation:
   ```bash
   curl http://localhost:3004/conversations/product-agent-1700000000.000001 | jq .
   ```

### 2.3 Verify Execution

5. [ ] Agent should respond in Slack thread (gathering requirements)
6. [ ] Agent creates Linear issue when requirements are clear

### 2.4 Verify Completion

7. [ ] Conversation reaches `"completed"` status
8. [ ] Linear issue exists with gathered requirements

## Flow 3: Edge Cases

### 3.1 Duplicate Event (Idempotent Start)

1. [ ] Send the same webhook event twice (same issueId / correlationKey):
   ```bash
   # First
   curl -X POST http://localhost:3004/events \
     -H 'Content-Type: application/json' \
     -d '{"id":"evt_dup1","type":"linear.agent_session.created","source":"linear","timestamp":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","correlationId":"dup-test-1","payload":{"issueId":"DUP-TEST"}}'

   # Second (same issueId)
   curl -X POST http://localhost:3004/events \
     -H 'Content-Type: application/json' \
     -d '{"id":"evt_dup2","type":"linear.agent_session.created","source":"linear","timestamp":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","correlationId":"dup-test-2","payload":{"issueId":"DUP-TEST"}}'
   ```
2. [ ] Verify second event returns same conversation ID (idempotent)
3. [ ] Only one conversation exists for this issueId

### 3.2 Conversation Cancel

1. [ ] Start a conversation (trigger webhook or manual POST)
2. [ ] Cancel it:
   ```bash
   curl -X POST http://localhost:3004/conversations/dev-agent-YOUR-ID/cancel | jq .
   ```
3. [ ] Verify status is `"cancelled"`
4. [ ] Verify further signals are rejected with `409`

### 3.3 Ignored Events

1. [ ] Send a `linear.issue.created` event (should be ignored):
   ```bash
   curl -X POST http://localhost:3004/events \
     -H 'Content-Type: application/json' \
     -d '{"id":"evt_ign1","type":"linear.issue.created","source":"linear","timestamp":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","correlationId":"ignore-test","payload":{"issueId":"IGN-1","title":"Test"}}'
   ```
2. [ ] Verify response: `{"received":true,"action":"ignored"}`

### 3.4 Invalid Payload

1. [ ] Send malformed event:
   ```bash
   curl -X POST http://localhost:3004/events \
     -H 'Content-Type: application/json' \
     -d '{"bad":"data"}'
   ```
2. [ ] Verify response: `400` with `{"error":"Validation failed","issues":[...]}`

### 3.5 Health Check

1. [ ] Test liveness endpoint:
   ```bash
   curl http://localhost:3004/health | jq .
   ```
   - Expected: `{"status":"ok","service":"agent-service"}`

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `"environment validation failed"` on startup | Missing env vars | Check `.env` has `ANTHROPIC_API_KEY`, `LINEAR_TEAM_ID`, `GITHUB_REPO`, `SLACK_CHANNEL_ID` |
| `"Conversation not found"` on GET | Wrong conversation ID format | Format is `{agent-id}-{correlation-key}` (e.g., `dev-agent-AES-42`) |
| Agent never picks up conversation | Worker not polling | Check logs for `"Worker loop started"` |
| Signal rejected with type mismatch | Wrong signal type | Signal `type` must match the agent's `wait_for` type (e.g., `"approval"`) |
| `"Conversation already in terminal state"` (409) | Conversation completed/failed/cancelled | Check status before signaling |
| Timeout on conversation | Agent loop error or LLM timeout | Check logs for Anthropic API errors or tool failures |
| `"No agent definition found"` | Missing YAML definition | Check `definitions/` directory has agent YAML files |
| MCP tool call fails | Integration service not running | Verify integration containers are healthy: `docker compose ps` |
| `pgboss` errors | pg-boss schema not created | Run `pnpm db:migrate` to ensure all schemas exist |

## Results

Record pass/fail for each flow after testing:

| Flow | Status | Notes | Date |
|------|--------|-------|------|
| Dev Agent (Linear -> PR) | [ ] Pass / [ ] Fail | | |
| Product Agent (Slack -> Linear) | [ ] Pass / [ ] Fail | | |
| Duplicate Event (Idempotent) | [ ] Pass / [ ] Fail | | |
| Conversation Cancel | [ ] Pass / [ ] Fail | | |
| Ignored Events | [ ] Pass / [ ] Fail | | |
| Invalid Payload (400) | [ ] Pass / [ ] Fail | | |
| Health Check | [ ] Pass / [ ] Fail | | |

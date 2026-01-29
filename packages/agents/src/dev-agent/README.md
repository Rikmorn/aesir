# Dev Agent

Autonomous development agent that automates Linear issue resolution.

## Overview

The dev-agent receives issue assignments from Linear and automates the development workflow:

```
Linear Issue → Research → Plan → Approval → Execute → PR → Review → Merge
```

## Architecture

```
dev-agent/
├── api/               # HTTP handlers and webhook processing
│   ├── events.ts      # Normalized event handler
│   ├── routes.ts      # Express route definitions
│   ├── signal-handler.ts  # Temporal signal utilities
│   ├── webhooks/      # Webhook-specific handlers
│   └── events/        # Event-specific handlers
├── code-workflow/     # Simple LangGraph code generation
│   ├── nodes/         # Workflow nodes (pickup, generate, test, commit)
│   ├── state/         # Workflow state definitions
│   ├── workflow.ts    # StateGraph definition
│   └── runner.ts      # Workflow execution
├── nodes/             # HITL workflow nodes
│   ├── receive-issue.ts
│   ├── research.ts
│   ├── plan.ts
│   ├── request-approval.ts
│   ├── execute.ts
│   ├── verify.ts
│   ├── create-pr.ts
│   ├── handle-feedback.ts
│   ├── re-plan.ts
│   ├── escalate.ts
│   ├── complete.ts
│   └── notify.ts
├── classification/    # Intent classification utilities
├── utils/             # Helper functions
├── graph.ts           # HITL LangGraph definition
├── state.ts           # HITL state schema
├── prompts.ts         # LLM prompts
├── main.ts            # HTTP server entry point
└── worker.ts          # Temporal worker entry point
```

## Two Workflow Modes

### 1. HITL Workflow (Human-in-the-Loop)

Full workflow with Temporal orchestration for complex tasks requiring approval:

1. **receive_issue** - Parse Linear issue context
2. **research** - Analyze codebase for relevant files
3. **plan** - Generate execution plan
4. **request_approval** - Post plan to Linear/Slack, wait for approval
5. **execute** - Run plan in sandbox container
6. **verify** - Run tests
7. **create_pr** - Open GitHub PR
8. **notify** - Send completion notification

Temporal signals enable:
- Plan approval/rejection
- PR feedback incorporation
- Escalation resolution

### 2. Code Workflow (Simple)

Lightweight LangGraph-only workflow for straightforward tasks:

1. **pickup_task** - Get task from Linear
2. **create_branch** - Create feature branch
3. **generate_code** - LLM generates implementation
4. **run_tests** - Execute test suite
5. **fix_code** - Address test failures (loop)
6. **commit_pr** - Commit and open PR

No approval gates, no Temporal involvement.

## Entry Points

### HTTP Server (`main.ts`)

Receives events from integration dispatchers:

```typescript
// Start HTTP server on port 3004
pnpm --filter @aesir/agents dev-agent
```

Endpoints:
- `POST /events` - Receive normalized events
- `GET /health` - Health check

### Temporal Worker (`worker.ts`)

Processes workflow activities:

```typescript
// Started automatically by docker-compose
// Or manually:
node dist/dev-agent/worker.js
```

Polls the `dev-agent` task queue for:
- `runDevAgentGraphActivity` - Execute LangGraph segments
- `continueAfterApprovalActivity` - Resume after approval
- `handlePRFeedbackActivity` - Process PR review feedback
- `stopContainerActivity` - Cleanup sandbox

## State Schema

```typescript
interface DevAgentState {
  taskId: string;
  phase: DevAgentPhase;
  issue?: LinearIssueContext;
  research?: ResearchContext;
  executionPlan?: ExecutionPlan;
  prNumber?: number;
  prUrl?: string;
  errorMessage?: string;
  // ... more fields
}
```

See `state.ts` for complete schema.

## Events Handled

- `linear.agent_session.created` - Start new workflow
- `linear.comment.created` - Approval via Linear comment
- `slack.block_actions.*` - Approval via Slack button
- `github.pull_request.merged/closed` - PR completion

## Configuration

Environment variables:
- `ANTHROPIC_API_KEY` - LLM API key
- `TEMPORAL_ADDRESS` - Temporal server
- `DATABASE_URL` - PostgreSQL for checkpointer
- `GITHUB_REPO_URL`, `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO` - Git operations
- `DEV_AGENT_SLACK_CHANNEL` - Notification channel

## Testing

```bash
pnpm --filter @aesir/agents test src/dev-agent
```

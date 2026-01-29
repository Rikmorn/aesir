# Product Agent

Conversational agent that gathers requirements from Slack and creates Linear issues.

## Overview

The product-agent handles @mentions and DMs in Slack to:

```
Slack Message → Classify → Gather Requirements → Confirm → Create Linear Issues
```

## Architecture

```
product-agent/
├── api/               # HTTP handlers
│   └── events.ts      # Normalized event handler
├── nodes/             # LangGraph workflow nodes
│   ├── classify.ts    # Intent classification
│   ├── analyze-requirements.ts
│   ├── generate-clarification.ts
│   ├── confirm.ts     # User confirmation
│   ├── create-tasks.ts
│   └── notify.ts      # Completion notification
├── slack/             # Slack-specific handlers
│   └── assistant/     # Thread event handlers
├── graph.ts           # LangGraph definition
├── state.ts           # State schema
├── prompts.ts         # LLM prompts
├── runner.ts          # Workflow execution
├── checkpointer.ts    # PostgreSQL state persistence
├── main.ts            # HTTP server entry point
└── worker.ts          # Temporal worker entry point
```

## Workflow

### Conversation Flow

1. **classify** - Determine message intent:
   - `feature_request` - New capability
   - `bug_report` - Issue to fix
   - `question` - Help request (no task creation)
   - `off_topic` - Unrelated message
   - `unclear` - Needs clarification

2. **analyze_requirements** - Extract structured requirements:
   - What needs to be done
   - Why it's needed
   - Who it's for
   - Constraints and priorities

3. **generate_clarification** - Ask follow-up questions if requirements are incomplete

4. **confirm** - Present summary and ask for confirmation

5. **create_tasks** - Create Linear issues from confirmed requirements

6. **notify** - Send issue link to Slack thread

### Multi-Turn Conversations

The agent maintains conversation state across multiple messages using PostgreSQL checkpointer. Thread timestamp (`thread_ts`) serves as the conversation ID.

## Entry Points

### HTTP Server (`main.ts`)

Receives events from Slack integration dispatcher:

```typescript
// Start HTTP server on port 3005
pnpm --filter @aesir/agents product-agent
```

Endpoints:
- `POST /events` - Receive normalized events
- `GET /health` - Health check

### Temporal Worker (`worker.ts`)

Processes workflow activities:

```typescript
// Started automatically by docker-compose
// Or manually:
node dist/product-agent/worker.js
```

Polls the `product-agent` task queue for:
- `runProductAgentActivity` - Execute LangGraph
- `sendSlackReplyActivity` - Post messages
- `sendApprovalRequestActivity` - Confirmation buttons

## State Schema

```typescript
interface ProductAgentState {
  messages: BaseMessage[];
  phase: ProductAgentPhase;
  slackContext?: SlackContext;
  classification?: MessageClassification;
  requirements?: Requirements;
  createdTasks?: CreatedTask[];
  loopCount: number;
  // ... more fields
}
```

See `state.ts` for complete schema.

## Events Handled

- `slack.message.app_mention` - @mention in channel
- `slack.message.direct_message` - DM to bot
- `slack.block_actions.*` - Button clicks

Thread replies are routed to existing conversations via `userReplySignal`.

## Configuration

Environment variables:
- `ANTHROPIC_API_KEY` - LLM API key
- `TEMPORAL_ADDRESS` - Temporal server
- `DATABASE_URL` - PostgreSQL for checkpointer
- `LINEAR_TEAM_ID` - Default team for issue creation
- `PRODUCT_AGENT_ALLOWED_CHANNELS` - Channel allowlist (optional)

## Testing

```bash
pnpm --filter @aesir/agents test src/product-agent
```

## E2E Verification

See [E2E-VERIFICATION.md](./E2E-VERIFICATION.md) for end-to-end test procedures.

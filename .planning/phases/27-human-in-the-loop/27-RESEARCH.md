# Phase 27: Human-in-the-Loop - Research

**Researched:** 2026-01-27
**Domain:** Temporal signal handling, Slack interactive components, Linear webhooks, LLM intent classification
**Confidence:** HIGH

## Summary

Phase 27 implements the signal handling that resumes Temporal workflows when humans approve plans or provide feedback. The existing infrastructure (Phase 26) already reaches `awaiting_approval` state and posts to both channels. This phase adds:

1. **Slack interactive handler** - Route `block_actions` events (button clicks) to signal Temporal workflows
2. **Linear comment webhook handler** - Detect approval intent in comments via LLM classification
3. **GitHub PR merge/close webhook handler** - Trigger task completion flows
4. **Cross-channel sync** - Update Linear when approval comes from Slack and vice versa
5. **Completion flows** - Update statuses, notify Slack, clean up containers

The architecture leverages existing patterns: dispatcher routes, MCP tools, Temporal signals, and LangGraph structured output.

**Primary recommendation:** Extend existing dispatcher routes to handle new event types (Slack block_actions, Linear comments, GitHub PR closed), implement LLM-based approval classification using withStructuredOutput pattern already used in product-agent, and add completion logic to dev-agent graph.

## Standard Stack

The existing codebase already has all required libraries.

### Core (Already Present)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @temporalio/workflow | ^1.x | Signal handling in workflows | Already used for planApprovalSignal |
| @temporalio/client | ^1.x | Signal sending from event handlers | Already used for workflow.start |
| @langchain/anthropic | ^0.x | LLM for intent classification | Already used for plan generation |
| @langchain/langgraph | ^0.x | Structured output for classification | Already used with withStructuredOutput |
| @slack/web-api | ^7.x | Message updates and responses | Already used for send_message MCP tool |
| zod | ^3.x | Schema validation for classification | Already used throughout codebase |

### Supporting (Already Present)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @aesir/common | workspace | NormalizedEvent, createId | Event handling |
| @aesir/integration-slack | workspace | MCP tools, event parsing | Slack interactions |
| @aesir/integration-linear | workspace | MCP tools, webhook handling | Linear comments |
| @aesir/integration-github | workspace | MCP tools, webhook handling | PR events |

### No New Dependencies Needed

The codebase has everything required. This phase is about wiring existing components together.

## Architecture Patterns

### Recommended Project Structure

New files needed:

```
packages/
├── agents/src/
│   ├── dev-agent/
│   │   ├── api/
│   │   │   └── events.ts       # EXTEND: Handle GitHub PR events, Slack block_actions
│   │   ├── nodes/
│   │   │   ├── complete.ts     # NEW: Task completion node
│   │   │   └── re-plan.ts      # NEW: Handle rejection with re-planning
│   │   └── classification/
│   │       └── approval.ts     # NEW: LLM approval intent classification
│   └── temporal/
│       └── activities/
│           └── dev-agent-activities.ts  # EXTEND: Add completion activities
├── integrations/
│   ├── slack/src/
│   │   ├── api/
│   │   │   └── interactions.ts # NEW: Slack interactive endpoint handler
│   │   └── dispatcher/
│   │       └── routes.ts       # EXTEND: Add block_actions route
│   ├── linear/src/
│   │   ├── api/
│   │   │   └── webhooks.ts     # EXTEND: Handle comment webhooks
│   │   └── dispatcher/
│   │       └── routes.ts       # EXTEND: Add comment routes
│   └── github/src/
│       ├── api/
│       │   └── webhooks.ts     # EXTEND: Handle PR closed events
│       └── dispatcher/
│           └── routes.ts       # Already has merged route
```

### Pattern 1: Slack Interactive Component Handler

**What:** Handle `block_actions` events from Slack when users click Approve/Reject buttons.

**When to use:** When Slack sends interactive payload after button click.

**Example:**

```typescript
// Source: Existing codebase pattern from packages/integrations/slack/src/events/parser.ts
// packages/integrations/slack/src/api/interactions.ts

import type { Request, Response } from "express";
import { Router } from "express";
import { Client as TemporalClient } from "@temporalio/client";
import { planApprovalSignal } from "@aesir/agents/temporal/signals";
import { verifySlackSignature } from "../webhooks/signature.js";

export function createInteractionsRouter(deps: {
  temporalClient: TemporalClient;
  logger: PinoLogger;
}): Router {
  const router = Router();

  // Slack sends interactivity payloads to /slack/interactions
  router.post("/interactions", async (req: Request, res: Response) => {
    // Slack sends payload as form-encoded with payload field containing JSON
    const payload = JSON.parse(req.body.payload);

    if (payload.type !== "block_actions") {
      res.status(200).json({ received: true });
      return;
    }

    // Extract action from the actions array
    const action = payload.actions[0];
    const actionId = action.action_id; // e.g., "approve_plan_ABC-123_pr"
    const taskId = action.value;       // The issue identifier stored in value

    // Determine approval decision
    const isApproval = actionId.includes("approve");
    const userId = payload.user.id;

    // Get workflow handle and send signal
    const workflowId = `dev-agent-${extractIssueUUID(taskId)}`;
    const handle = deps.temporalClient.workflow.getHandle(workflowId);

    await handle.signal(planApprovalSignal, {
      approved: isApproval,
      feedback: isApproval ? undefined : "Rejected via Slack button",
    });

    // Update the original message to remove buttons
    // (Done in Temporal activity after signal received)

    // Acknowledge immediately (Slack 3-second rule)
    res.status(200).json({ received: true });
  });

  return router;
}
```

### Pattern 2: LLM-Based Approval Classification

**What:** Use LLM structured output to classify natural language as approve/reject/unclear.

**When to use:** When Linear comment or Slack thread message needs intent classification.

**Example:**

```typescript
// Source: Existing pattern from packages/agents/src/product-agent/nodes/classify.ts
// packages/agents/src/dev-agent/classification/approval.ts

import { z } from "zod";
import type { ChatAnthropic } from "@langchain/anthropic";

export const ApprovalClassificationSchema = z.object({
  intent: z.enum(["approve", "reject", "unclear", "question"]),
  confidence: z.enum(["high", "medium", "low"]),
  feedback: z.string().nullable().describe("Extracted feedback if rejection or changes requested"),
  reasoning: z.string().describe("Why this classification was made"),
});

export type ApprovalClassification = z.infer<typeof ApprovalClassificationSchema>;

const APPROVAL_CLASSIFICATION_PROMPT = `You are classifying a human's response to an implementation plan.

The plan was posted for approval. The human has responded with the message below.

Classify their intent:
- "approve": They want to proceed (e.g., "looks good", "ship it", "approved", "go ahead", thumbs up, checkmark)
- "reject": They do NOT want to proceed and have feedback (e.g., "no", "don't do this", specific concerns)
- "unclear": You cannot determine intent (e.g., off-topic, ambiguous)
- "question": They are asking a question, not giving approval (e.g., "what about X?", "did you consider Y?")

If rejecting, extract their feedback for the agent to address.

Human response:
{message}`;

export async function classifyApprovalIntent(
  llm: ChatAnthropic,
  message: string,
): Promise<ApprovalClassification> {
  const structured = llm.withStructuredOutput(ApprovalClassificationSchema, {
    name: "approval_classification",
  });

  const result = await structured.invoke(
    APPROVAL_CLASSIFICATION_PROMPT.replace("{message}", message)
  );

  return result;
}
```

### Pattern 3: GitHub PR Closed Webhook Handler

**What:** Handle PR closed/merged events to trigger task completion.

**When to use:** When GitHub sends pull_request webhook with action=closed.

**Example:**

```typescript
// Source: Existing pattern from packages/integrations/github/src/api/webhooks.ts
// EXTEND existing webhook handler

// In webhook router, add handling for pull_request events:
if (eventType === "pull_request") {
  const payload = parsePullRequestPayload(rawBody);

  if (payload.action === "closed") {
    const isMerged = payload.pull_request.merged === true;

    // Normalize and dispatch
    const normalizedEvent = normalizePRClosedEvent(
      payload,
      deliveryId,
      isMerged
    );

    dispatcher.dispatch(normalizedEvent);
  }
}

// In normalize.ts:
export function normalizePRClosedEvent(
  payload: PRPayload,
  deliveryId: string,
  isMerged: boolean,
): NormalizedEvent {
  return {
    id: createId.event(),
    type: isMerged ? "github.pull_request.merged" : "github.pull_request.closed",
    source: "github",
    timestamp: new Date().toISOString(),
    correlationId: deliveryId,
    payload: {
      prNumber: payload.pull_request.number,
      prTitle: payload.pull_request.title,
      prUrl: payload.pull_request.html_url,
      merged: isMerged,
      mergedBy: isMerged ? payload.pull_request.merged_by?.login : null,
      repository: {
        owner: payload.repository.owner.login,
        name: payload.repository.name,
      },
    },
  };
}
```

### Pattern 4: Cross-Channel Sync

**What:** When approval comes from one channel, update the other channel.

**When to use:** After processing approval from Slack, update Linear; vice versa.

**Example:**

```typescript
// In Temporal activity after approval signal received:
export async function syncApprovalToLinear(input: {
  issueId: string;
  approvedBy: string;
  channel: "slack" | "linear";
  correlationId: string;
}): Promise<void> {
  if (input.channel === "slack") {
    // Approval came from Slack, update Linear
    await callMcpTool({
      integration: "linear",
      tool: "create_comment",
      params: {
        issueId: input.issueId,
        body: `Plan approved via Slack by @${input.approvedBy}`,
      },
      agentId: "dev-agent",
      correlationId: input.correlationId,
    });

    await callMcpTool({
      integration: "linear",
      tool: "update_issue_status",
      params: {
        issueId: input.issueId,
        statusName: "Executing",
      },
      agentId: "dev-agent",
      correlationId: input.correlationId,
    });
  }
  // vice versa for linear -> slack
}
```

### Pattern 5: Slack Message Update After Approval

**What:** Update the approval request message to show who approved and remove buttons.

**When to use:** After approval signal is received, before continuing execution.

**Example:**

```typescript
// Use existing update_message MCP tool
await callMcpTool({
  integration: "slack",
  tool: "update_message",
  params: {
    channel: slackChannel,
    ts: slackMessageTs,  // Stored in workflow state
    text: `Plan approved by @${approverName} at ${formatTime(Date.now())}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Plan Approved* :white_check_mark:\nApproved by <@${userId}> at ${formatTime(Date.now())}\n\nExecuting... Estimated time: ~${estimatedTime}`,
        },
      },
    ],
  },
  agentId: "dev-agent",
  correlationId,
});
```

### Anti-Patterns to Avoid

- **Polling for approval** - Never poll Linear/Slack for changes. Use webhooks and signals.
- **Blocking webhook handlers** - Always respond to webhooks within 3 seconds (Slack) / quickly. Do async processing.
- **Direct SDK calls from agents** - Always use MCP tools for agent-integration communication.
- **Assuming workflow exists** - Check for WorkflowNotFoundError when sending signals.
- **Ignoring race conditions** - First response wins, but handle potential duplicate signals gracefully.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Slack signature verification | Custom HMAC | @slack/bolt or existing verifySlackSignature | Timing-safe comparison required |
| Intent classification | Regex matching | LLM with structured output | Natural language is ambiguous |
| Workflow signal delivery | Direct DB updates | Temporal signals | Durability, exactly-once semantics |
| Message deduplication | In-memory set | Existing delivery stores | Persistence across restarts |
| Container cleanup | Manual Docker calls | DevContainerManager.cleanup() | Already handles edge cases |

**Key insight:** The codebase already has all the patterns needed. This phase is wiring, not building.

## Common Pitfalls

### Pitfall 1: Slack 3-Second Timeout

**What goes wrong:** Slack expects webhook response within 3 seconds. Workflow signal sending or LLM classification takes longer.
**Why it happens:** Processing happens synchronously in request handler.
**How to avoid:**
1. Acknowledge immediately with 200
2. Process async (fire-and-forget or background job)
3. Use response_url for delayed responses if needed
**Warning signs:** Slack shows "operation_timeout" or retries the same request.

### Pitfall 2: Duplicate Signal Handling

**What goes wrong:** Same approval comes from both Slack and Linear (race condition).
**Why it happens:** User clicks Slack button, then also comments "approved" on Linear.
**How to avoid:**
1. First signal wins - Temporal workflow only processes first
2. Signal handler is idempotent (setting approved=true twice is safe)
3. Check state before processing: `if (state.approval !== null) return;`
**Warning signs:** Duplicate notifications or double processing.

### Pitfall 3: Workflow Not Found

**What goes wrong:** Sending signal to non-existent or completed workflow.
**Why it happens:** Workflow timed out, or event arrives after completion.
**How to avoid:**
1. Catch `WorkflowNotFoundError` specifically
2. Log warning but don't fail the request
3. Optionally notify user that the workflow has ended
**Warning signs:** Unhandled exceptions in event handlers.

### Pitfall 4: Missing Issue UUID Mapping

**What goes wrong:** Can't find Temporal workflow ID from Linear issue identifier.
**Why it happens:** Workflow ID uses issue UUID (`dev-agent-{uuid}`), but UI shows identifier (`ABC-123`).
**How to avoid:**
1. Store mapping or use MCP get_issue to resolve identifier -> UUID
2. Or: change workflow ID to use identifier (breaking change)
3. Or: store identifier in workflow state and use query
**Warning signs:** "Workflow not found" when trying to signal.

### Pitfall 5: Block Actions Payload Format

**What goes wrong:** Parsing errors when handling Slack interactive payloads.
**Why it happens:** Slack sends body as `application/x-www-form-urlencoded` with `payload` field containing JSON string.
**How to avoid:**
1. Use `express.urlencoded({ extended: true })` middleware
2. Parse `req.body.payload` as JSON: `JSON.parse(req.body.payload)`
3. Separate route from Events API (different format)
**Warning signs:** Empty or undefined payload, parsing exceptions.

### Pitfall 6: PR Close vs Merge Confusion

**What goes wrong:** Treating all PR closes as successful completions.
**Why it happens:** GitHub sends `action: "closed"` for both merged and closed-without-merge.
**How to avoid:**
1. Always check `pull_request.merged === true` for merges
2. Handle closed-without-merge as potential cancellation
3. Use LLM to interpret context if needed (closing comment, Linear status)
**Warning signs:** Marking tasks "done" when PR was abandoned.

## Code Examples

Verified patterns from the existing codebase:

### Temporal Signal Definition and Sending

```typescript
// Source: packages/agents/src/temporal/signals.ts (existing)
import * as wf from "@temporalio/workflow";

export const planApprovalSignal =
  wf.defineSignal<[{ approved: boolean; feedback?: string }]>("planApproval");

// Sending from client (in event handler):
// Source: https://docs.temporal.io/develop/typescript/message-passing
const handle = temporalClient.workflow.getHandle(workflowId);
await handle.signal(planApprovalSignal, { approved: true });
```

### Signal Handler in Workflow

```typescript
// Source: packages/agents/src/temporal/workflows/dev-agent-workflow.ts (existing)
wf.setHandler(planApprovalSignal, (decision) => {
  wf.log.info("Received plan approval signal", { approved: decision.approved });
  state.approval = decision;
});

// Wait with timeout
const receivedApproval = await wf.condition(
  () => state.approval !== null,
  APPROVAL_TIMEOUT,
);
```

### Structured Output for Classification

```typescript
// Source: Pattern from packages/agents/src/product-agent/nodes/classify.ts
const structured = llm.withStructuredOutput(ClassificationSchema, {
  name: "classification",
});

const result = await structured.invoke(prompt);
```

### MCP Tool Call

```typescript
// Source: packages/agents/src/mcp/index.ts (existing)
await callMcpTool({
  integration: "slack",
  tool: "update_message",
  params: { channel, ts, text, blocks },
  agentId: "dev-agent",
  correlationId: taskId,
});
```

### Dispatcher Route Configuration

```typescript
// Source: packages/integrations/slack/src/dispatcher/routes.ts (existing pattern)
export const DISPATCH_ROUTES: DispatchRoute[] = [
  {
    eventType: "slack.block_actions.button_clicked",
    target: process.env.DEV_AGENT_URL || "http://dev-agent:3004/events",
    mode: "sync",
  },
];
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Polling for approval | Webhook + Signal | Standard pattern | Real-time, efficient |
| Regex intent detection | LLM classification | 2024+ | Handles natural language |
| Separate modal for feedback | Thread-based feedback | UX preference | Simpler interaction |

**Deprecated/outdated:**
- Slack RTM API: Use Events API with webhooks instead
- response_url: Marked as deprecated for new Slack apps, but still works

## Open Questions

Things resolved by context decisions:

1. **Authorization checks** - Context says "Anyone can approve" for now, no auth needed.
2. **Re-plan iteration limits** - Context says "No hard limit, LLM detects circles."
3. **ETA estimation** - Context says "Claude's discretion based on plan complexity."
4. **Timeout values** - Context says "24h/72h" for approval, other timeouts at Claude's discretion.

Things that may need validation during implementation:

1. **Linear comment webhook availability**
   - What we know: Linear has webhooks for issues, but comment-specific webhooks need verification
   - What's unclear: Exact webhook type for comments
   - Recommendation: Check Linear webhook configuration or use polling as fallback

2. **Slack interactive endpoint configuration**
   - What we know: Block actions go to Interactivity & Shortcuts URL in app config
   - What's unclear: Current app configuration status
   - Recommendation: Verify Slack app has interactivity URL configured

## Sources

### Primary (HIGH confidence)
- [Temporal TypeScript Message Passing](https://docs.temporal.io/develop/typescript/message-passing) - Signal handlers, conditions, timeouts
- [Slack Block Actions Payload](https://docs.slack.dev/reference/interaction-payloads/block_actions-payload) - Interactive component structure
- [GitHub Webhook Events](https://docs.github.com/en/webhooks/webhook-events-and-payloads) - PR closed/merged detection
- Existing codebase patterns in packages/agents/src/temporal/ and packages/integrations/

### Secondary (MEDIUM confidence)
- [LangGraph agents-from-scratch-ts](https://github.com/langchain-ai/agents-from-scratch-ts) - HITL patterns with LangGraph
- [Temporal samples-typescript](https://github.com/temporalio/samples-typescript) - Signal patterns

### Tertiary (LOW confidence)
- Web search results for current year patterns - Verified against official docs

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already in codebase
- Architecture: HIGH - Extends existing patterns (dispatchers, signals, MCP)
- Pitfalls: HIGH - Based on codebase analysis and official documentation

**Research date:** 2026-01-27
**Valid until:** 2026-02-27 (30 days - stable patterns)

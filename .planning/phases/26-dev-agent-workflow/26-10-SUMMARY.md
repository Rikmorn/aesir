---
phase: 26-dev-agent-workflow
plan: 10
completed: 2026-01-26
duration: ~8 min
subsystem: agents/temporal
tags: [temporal, workflow, signals, durability]

dependency-graph:
  requires: ["26-09"] # LangGraph StateGraph
  provides: ["devAgentWorkflow", "devAgentActivities", "devAgentSignals"]
  affects: ["26-11", "26-12", "26-13"] # Worker, HTTP entrypoint, E2E

tech-stack:
  added: []
  patterns: ["signal-based-flow", "timeout-pattern", "proxyActivities"]

key-files:
  created:
    - packages/agents/src/temporal/workflows/dev-agent-workflow.ts
    - packages/agents/src/temporal/activities/dev-agent-activities.ts
  modified:
    - packages/agents/src/temporal/signals.ts
    - packages/agents/src/temporal/types.ts
    - packages/agents/src/temporal/workflows/index.ts
    - packages/agents/src/temporal/activities/index.ts

decisions:
  - id: "signal-names"
    choice: "planApproval, prFeedback, escalationResolved"
    reason: "Clear naming that matches the action being taken"

metrics:
  tasks: 3/3
  commits: 3
---

# Phase 26 Plan 10: Temporal Workflow Wrapper Summary

Temporal workflow with signal-based approval/feedback handling, 24h/72h timeout pattern, and graph activity invocation.

## What Was Built

### 1. Dev-Agent Signals (signals.ts)

Three new signals for workflow control:

```typescript
// Plan approval from Linear comment or Slack button
export const planApprovalSignal = wf.defineSignal<[{ approved: boolean; feedback?: string }]>("planApproval");

// PR review feedback from GitHub
export const prFeedbackSignal = wf.defineSignal<[string]>("prFeedback");

// Human resolution of escalation
export const escalationResolvedSignal = wf.defineSignal<[{ action: "retry" | "abort"; guidance?: string }]>("escalationResolved");
```

### 2. Dev-Agent Types (types.ts)

Workflow input/output types:

```typescript
interface DevAgentWorkflowInput {
  taskId: string;           // Linear issue UUID
  issueIdentifier: string;  // e.g., "ABC-123"
  issue: { id, identifier, title, description, priority, labels };
  slackChannel: string;
}

type DevAgentWorkflowPhase =
  | "pending" | "setup" | "researching" | "planning"
  | "awaiting_approval" | "executing" | "verifying" | "creating_pr"
  | "complete" | "awaiting_feedback" | "addressing_feedback"
  | "escalated" | "failed" | "timeout";

interface DevAgentWorkflowResult {
  success: boolean;
  phase: DevAgentWorkflowPhase;
  prNumber?: number;
  prUrl?: string;
  errorMessage?: string;
}
```

### 3. Dev-Agent Activities (dev-agent-activities.ts)

Five activities with DI pattern:

| Activity | Purpose |
|----------|---------|
| `runDevAgentGraphActivity` | Invoke LangGraph from start to stopping point |
| `continueAfterApprovalActivity` | Resume from executing phase after approval |
| `handlePRFeedbackActivity` | Process PR review feedback |
| `stopContainerActivity` | Stop container on timeout (24h) |
| `sendReminderActivity` | Send Slack reminder notifications |

DI initialization at worker startup:
```typescript
initDevAgentActivities({
  manager, git, repoUrl, githubToken,
  owner, repo, baseBranch, slackChannel,
  llm, checkpointer
});
```

### 4. Dev-Agent Workflow (dev-agent-workflow.ts)

Main workflow with signal handling:

```typescript
export async function devAgentWorkflow(input: DevAgentWorkflowInput): Promise<DevAgentWorkflowResult> {
  // 1. Run graph until awaiting_approval
  graphResult = await runDevAgentGraphActivity({...});

  // 2. Wait for approval signal
  if (state.phase === "awaiting_approval") {
    const approved = await wf.condition(() => state.approval !== null, "24 hours");
    if (!approved) {
      await stopContainerActivity(taskId);  // 24h timeout
      await sendReminderActivity({...});
      // Wait 48h more (72h total)
      const lateApproval = await wf.condition(..., "48 hours");
      if (!lateApproval) return { success: false, phase: "timeout" };
    }
  }

  // 3. Continue execution after approval
  graphResult = await continueAfterApprovalActivity({...});

  // 4. Wait for optional PR feedback
  if (state.phase === "complete") {
    const feedback = await wf.condition(() => state.prFeedback !== null, "7 days");
    if (feedback) await handlePRFeedbackActivity({...});
  }
}
```

Timeout configuration:
- **24h**: Stop container, send reminder (APPROVAL_TIMEOUT)
- **72h**: End workflow (APPROVAL_TIMEOUT + REMINDER_WAIT)
- **7 days**: PR feedback wait (FEEDBACK_TIMEOUT)

## Key Patterns

### Signal-Based Flow Control

```typescript
wf.setHandler(planApprovalSignal, (decision) => {
  state.approval = decision;
});

// Wait for signal with timeout
const received = await wf.condition(
  () => state.approval !== null,
  "24 hours"
);
```

### Activity Configuration

```typescript
const activities = proxyActivities<DevAgentActivities>({
  startToCloseTimeout: "30 minutes",
  retry: {
    maximumAttempts: 3,
    initialInterval: "5 seconds",
    backoffCoefficient: 2,
  },
});
```

### Query for Status Inspection

```typescript
export const devAgentStatusQuery = wf.defineQuery<DevAgentQueryStatus>("devAgentStatus");

// Usage: client can query workflow status without signals
```

## Workflow Flow

```
START
  |
  v
runDevAgentGraphActivity (pending -> awaiting_approval)
  |
  v
[Wait for planApprovalSignal]
  |     |
  |     +-- 24h timeout: stop container, send reminder
  |     |
  |     +-- 72h timeout: return { phase: "timeout" }
  |
  v
continueAfterApprovalActivity (executing -> complete)
  |
  v
[Wait for optional prFeedbackSignal]
  |     |
  |     +-- 7 days timeout: return success
  |
  v
handlePRFeedbackActivity (if feedback received)
  |
  v
END
```

## Deviations from Plan

None - plan executed exactly as written.

## Next Phase Readiness

Plan 26-11 (Temporal Worker) can now:
- Import devAgentWorkflow from workflows/index.ts
- Import activities from activities/index.ts
- Call initDevAgentActivities() at worker startup
- Register devAgentWorkflow with worker

## Commits

| Hash | Message |
|------|---------|
| 095fb93 | feat(26-10): add dev-agent signals and types |
| d55af61 | feat(26-10): create dev-agent Temporal activities |
| 87c14ad | feat(26-10): create dev-agent Temporal workflow |

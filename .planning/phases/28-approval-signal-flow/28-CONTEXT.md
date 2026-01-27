# Phase 28: Approval Signal Flow

## Background

During Phase 26 E2E verification, a critical gap was discovered: the Slack "Approve" button click is received but not processed. The workflow waits indefinitely because no code sends the Temporal signal.

## Problem Statement

The dev-agent workflow reaches `awaiting_approval` phase and posts approval buttons to Slack. When a user clicks "Approve":

1. Slack sends `block_actions` event to slack-integration
2. Event is logged but no handler processes it
3. Workflow remains stuck waiting for `planApprovalSignal`

## Gap Analysis

| Component | Expected | Actual |
|-----------|----------|--------|
| Slack block_actions handler | Parse action_id, call dev-agent | Missing |
| Dev-agent /approval endpoint | Receive approval, send signal | Missing |
| Temporal signal sender | workflowClient.signal() | Missing |

## Required Implementation

### 1. Dev-Agent Approval Endpoint

`POST /approval` endpoint in `packages/agents/src/dev-agent/api/`:

```typescript
interface ApprovalRequest {
  issueIdentifier: string;  // e.g., "ON-1109"
  approved: boolean;
  feedback?: string;
}
```

The endpoint must:
- Look up Linear issue UUID from identifier (via MCP or direct lookup)
- Get workflow handle: `workflowClient.workflow.getHandle("dev-agent-{issueUUID}")`
- Send signal: `handle.signal(planApprovalSignal, { approved, feedback })`
- Return success/failure

### 2. Slack Block Actions Handler

In `packages/integrations/slack/src/main.ts` (Socket Mode):

```typescript
boltApp.action(/^approve_plan_.*/, async ({ action, ack, body }) => {
  await ack();
  // Parse action_id: "approve_plan_ON-1109_approve" or "approve_plan_ON-1109_reject"
  // Call POST dev-agent:3004/approval
});
```

### 3. Signal Flow

```
Slack button click
    ↓
block_actions handler parses action_id
    ↓
POST http://dev-agent:3004/approval { issueIdentifier, approved }
    ↓
Dev-agent looks up workflow by issue identifier
    ↓
Dev-agent sends planApprovalSignal to Temporal
    ↓
Workflow continues to executing phase
```

## Existing Code References

- Approval request node: `packages/agents/src/dev-agent/nodes/request-approval.ts`
- Temporal workflow with signal: `packages/agents/src/temporal/workflows/dev-agent-workflow.ts`
- Signal definitions: `packages/agents/src/temporal/signals.ts`
- Slack approval blocks: `packages/integrations/slack/src/messages/blocks.ts`

## Dependencies

- Phase 26 (dev-agent workflow) - provides workflow and signal infrastructure
- Blocks Phase 27 (human-in-the-loop) - requires working approval flow

## Success Criteria

1. User clicks "Approve" in Slack
2. Slack integration receives and processes block_actions
3. Dev-agent receives approval request
4. Temporal signal sent to waiting workflow
5. Workflow continues to executing phase
6. E2E test passes: Linear issue → approval → PR created

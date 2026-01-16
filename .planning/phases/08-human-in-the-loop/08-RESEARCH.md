# Phase 8: Human-in-the-Loop - Research

**Researched:** 2026-01-16
**Domain:** Async approval workflows with durable execution
**Confidence:** HIGH

<research_summary>
## Summary

Researched patterns for implementing human-in-the-loop approval gates in the existing Aesir workflow system. The core requirement is pausing the Dev Agent workflow after PR creation to await human approval before merge.

**Key finding:** The existing LangGraph workflow is insufficient for durable human handoffs. LangGraph's `interrupt()` requires continuous process execution or a persistent checkpointer, and doesn't provide the production-grade durability needed for approvals that may take hours or days.

**Primary recommendation:** Wrap the existing LangGraph Dev Workflow in a Temporal workflow for the human approval gate. Temporal provides:
- Durable execution that survives process restarts
- Signal-based approval delivery with zero polling
- Built-in timeout handling for approval expiration
- Clean integration without rewriting existing LangGraph code

**Architecture:** Two-layer approach - Temporal orchestrates the macro workflow (task → code → test → PR → approval → merge), while LangGraph handles the micro workflow (the agent's internal code generation loop).
</research_summary>

<standard_stack>
## Standard Stack

The established libraries/tools for durable human-in-the-loop workflows:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @temporalio/workflow | 1.11.x | Workflow definitions with signal handling | Industry standard for durable execution |
| @temporalio/worker | 1.11.x | Worker process that executes workflows | Required for Temporal |
| @temporalio/client | 1.11.x | Client API for starting workflows, sending signals | Required for external approval integration |
| @temporalio/activity | 1.11.x | Activity definitions for external calls | Wraps LangGraph execution and integrations |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @temporalio/common | 1.11.x | Shared types and utilities | Always with other Temporal packages |
| Temporal Cloud / temporalite | - | Temporal server | Cloud for prod, temporalite for local dev |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Temporal | LangGraph interrupt() | Interrupt requires persistent checkpointer (Postgres) and doesn't handle multi-day pauses well |
| Temporal | Simple polling loop | No durability, wastes resources, complex state management |
| Temporal | Slack interactive buttons with webhook | State not durable, must handle Slack retries, no built-in timeout |
| Temporal | AWS Step Functions | Vendor lock-in, less flexible, weaker TypeScript support |

**Installation:**
```bash
npm install @temporalio/client @temporalio/worker @temporalio/workflow @temporalio/activity @temporalio/common
```

**Note:** All @temporalio/* packages must have the same version number.
</standard_stack>

<architecture_patterns>
## Architecture Patterns

### Recommended Project Structure
```
src/
├── temporal/
│   ├── workflows/        # Temporal workflow definitions
│   │   └── approval-workflow.ts
│   ├── activities/       # Activities wrapping external calls
│   │   ├── dev-agent-activity.ts    # Wraps LangGraph execution
│   │   ├── github-activities.ts     # PR merge operations
│   │   └── slack-activities.ts      # Notification activities
│   ├── signals.ts        # Signal type definitions
│   ├── worker.ts         # Worker process entry point
│   └── client.ts         # Client utilities
├── agents/               # Existing LangGraph code (unchanged)
└── integrations/         # Existing integrations (unchanged)
```

### Pattern 1: Signal-Based Approval Gate
**What:** Workflow pauses with `condition()`, resumes on approval signal
**When to use:** When human decision is binary (approve/reject)
**Example:**
```typescript
// Source: Temporal TypeScript SDK docs
import * as wf from '@temporalio/workflow';

// Define signal outside workflow
export const approvalSignal = wf.defineSignal<[ApprovalDecision]>('approval');
export const approvalQuery = wf.defineQuery<ApprovalStatus>('approvalStatus');

interface ApprovalDecision {
  approved: boolean;
  approver: string;
  comment?: string;
}

export async function approvalWorkflow(taskId: string): Promise<WorkflowResult> {
  let decision: ApprovalDecision | null = null;

  // Set up signal handler
  wf.setHandler(approvalSignal, (input: ApprovalDecision) => {
    decision = input;
  });

  // Query handler for status checks
  wf.setHandler(approvalQuery, () => ({
    taskId,
    awaiting: decision === null,
    decision,
  }));

  // Run dev agent activity (wraps LangGraph workflow)
  const prResult = await runDevAgentActivity(taskId);

  // Send Slack notification
  await sendApprovalRequestActivity(taskId, prResult.prUrl);

  // Wait for approval signal OR timeout
  const approved = await wf.condition(
    () => decision !== null,
    '7 days'  // Approval expires after 7 days
  );

  if (!approved || !decision?.approved) {
    // Timeout or rejection
    return { success: false, reason: decision?.comment ?? 'Approval timeout' };
  }

  // Merge the PR
  await mergePRActivity(prResult.prNumber);

  return { success: true, prNumber: prResult.prNumber };
}
```

### Pattern 2: Activity Wrapping Existing LangGraph
**What:** Wrap the existing `runDevWorkflow` function as a Temporal activity
**When to use:** Keep existing LangGraph code, add durability layer
**Example:**
```typescript
// Source: Grid Dynamics migration case study
// activities/dev-agent-activity.ts
import { runDevWorkflow } from '../../agents/dev-workflow-runner.js';
import type { DevWorkflowDependencies } from '../../agents/dev-workflow.js';

export async function runDevAgentActivity(
  taskId: string,
  deps: DevWorkflowDependencies
): Promise<DevWorkflowResult> {
  // Existing LangGraph workflow runs inside activity
  return runDevWorkflow(taskId, deps);
}
```

### Pattern 3: Timeout with Escalation
**What:** Multi-tier timeout with escalation signals
**When to use:** When approval has SLAs or needs escalation
**Example:**
```typescript
// Wait for approval with escalation tiers
const escalationMinutes = [60, 240, 1440]; // 1hr, 4hr, 24hr
let escalationIndex = 0;

while (!decision && escalationIndex < escalationMinutes.length) {
  const timeout = `${escalationMinutes[escalationIndex]} minutes`;

  const received = await wf.condition(() => decision !== null, timeout);

  if (!received) {
    // Escalate
    await sendEscalationActivity(taskId, escalationIndex);
    escalationIndex++;
  }
}
```

### Anti-Patterns to Avoid
- **Polling for approval status:** Use signals instead, they're instant and durable
- **Storing approval state in external DB:** Temporal IS your state store, use queries
- **Running LangGraph in workflow code:** LangGraph is non-deterministic, wrap in activity
- **Multiple signal handlers modifying same state:** Use mutex or single handler
- **Not waiting for handlers to complete:** Always `await condition(allHandlersFinished)` before exit
</architecture_patterns>

<dont_hand_roll>
## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Durable workflow state | Redis/DB + polling | Temporal workflows | Temporal handles replay, versioning, persistence automatically |
| Approval timeout handling | setTimeout + cron | `wf.condition(predicate, timeout)` | Durable sleep survives crashes, timeout is exact |
| Signal delivery | Webhook + retry logic | Temporal signals | Guaranteed delivery, automatic retries, ordering |
| Status queries | REST endpoint + DB | `wf.defineQuery()` | Consistent reads from workflow state, no stale data |
| Workflow restart after crash | Checkpoint + recovery code | Temporal's durable execution | Workflow replays exactly, no manual recovery |
| Concurrent approval handling | Locks + DB transactions | Temporal's single-threaded execution | No race conditions by design |

**Key insight:** Temporal's value is eliminating infrastructure code. The Grid Dynamics case study showed they deleted thousands of lines of retry/error handling code after migration. If you're writing try/catch blocks around signal handling, you're doing it wrong.
</dont_hand_roll>

<common_pitfalls>
## Common Pitfalls

### Pitfall 1: Non-Deterministic Code in Workflow
**What goes wrong:** Workflow fails on replay with non-determinism error
**Why it happens:** Workflow code must produce identical results when replayed
**How to avoid:**
- Never use `Math.random()`, `Date.now()`, or `uuid()` in workflow code
- Use `wf.uuid4()` and `wf.now()` instead
- Put all non-deterministic code in activities
**Warning signs:** `DeterminismViolationError` or `NonDeterminismError` in logs

### Pitfall 2: Signal Handler Runs Before Workflow Initialization
**What goes wrong:** Handler reads uninitialized variables, produces wrong state
**Why it happens:** Signals can arrive before main workflow code runs (esp. with signal-with-start)
**How to avoid:**
- Initialize all state variables at top of workflow function
- Set up handlers immediately after initialization
- Never rely on workflow code running before first signal
**Warning signs:** Undefined values in handler, inconsistent state

### Pitfall 3: Activity Execution Inside Signal Handler Without Mutex
**What goes wrong:** Multiple concurrent activities corrupt state
**Why it happens:** Async signal handlers can run interleaved
**How to avoid:**
- Use `workflow.Mutex` for handlers that call activities
- Or queue signals and process sequentially in main workflow
**Warning signs:** Race conditions, duplicate operations, state corruption

### Pitfall 4: Forgetting to Wait for Handlers Before Workflow Exit
**What goes wrong:** In-progress handlers get terminated mid-execution
**Why it happens:** Workflow returns while signal handler is still running async operations
**How to avoid:**
```typescript
// At end of workflow, before return
await wf.condition(wf.allHandlersFinished);
return result;
```
**Warning signs:** Incomplete operations, dropped signals near workflow completion

### Pitfall 5: Workflow History Growth Without Continue-As-New
**What goes wrong:** Workflow becomes slow, eventually fails
**Why it happens:** Each event adds to history, replay takes longer
**How to avoid:**
- Use `continueAsNew()` for workflows that run indefinitely
- For approval workflows (finite), usually not an issue
**Warning signs:** Increasing workflow task latency, large event histories
</common_pitfalls>

<code_examples>
## Code Examples

Verified patterns from official sources:

### Basic Workflow with Signal and Timeout
```typescript
// Source: Temporal TypeScript SDK message-passing docs
import * as wf from '@temporalio/workflow';
import { proxyActivities } from '@temporalio/workflow';
import type * as activities from '../activities';

const { sendSlackNotification, mergePR } = proxyActivities<typeof activities>({
  startToCloseTimeout: '5 minutes',
  retry: {
    maximumAttempts: 3,
  },
});

export const approvalSignal = wf.defineSignal<[{ approved: boolean; by: string }]>('approval');

export async function prApprovalWorkflow(prNumber: number, prUrl: string): Promise<boolean> {
  let approved: boolean | null = null;

  wf.setHandler(approvalSignal, (decision) => {
    approved = decision.approved;
    wf.log.info('Received approval decision', { approved, by: decision.by });
  });

  // Notify via Slack
  await sendSlackNotification({ prNumber, prUrl });

  // Wait up to 7 days for approval
  const receivedDecision = await wf.condition(() => approved !== null, '7 days');

  if (!receivedDecision) {
    wf.log.warn('Approval timed out');
    return false;
  }

  if (approved) {
    await mergePR(prNumber);
  }

  return approved ?? false;
}
```

### Worker Setup
```typescript
// Source: Temporal TypeScript SDK core-application docs
import { Worker, NativeConnection } from '@temporalio/worker';
import * as activities from './activities';

async function run() {
  const connection = await NativeConnection.connect({
    address: process.env.TEMPORAL_ADDRESS ?? 'localhost:7233',
  });

  const worker = await Worker.create({
    connection,
    namespace: 'default',
    taskQueue: 'aesir-approval',
    workflowsPath: require.resolve('./workflows'),
    activities,
  });

  await worker.run();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

### Sending Signal from Slack Webhook Handler
```typescript
// Source: Temporal TypeScript SDK client docs
import { Client, Connection } from '@temporalio/client';
import { approvalSignal } from './workflows/approval-workflow';

export async function handleSlackApproval(
  workflowId: string,
  approved: boolean,
  approverUserId: string
): Promise<void> {
  const connection = await Connection.connect({
    address: process.env.TEMPORAL_ADDRESS ?? 'localhost:7233',
  });
  const client = new Client({ connection });

  const handle = client.workflow.getHandle(workflowId);

  await handle.signal(approvalSignal, {
    approved,
    by: approverUserId,
  });
}
```

### Activity Wrapping Existing LangGraph
```typescript
// Source: Pattern from Grid Dynamics migration
import { runDevWorkflow, type DevWorkflowResult } from '../../agents/dev-workflow-runner';
import type { DevWorkflowDependencies } from '../../agents/dev-workflow';

// Activities are NOT deterministic, so LangGraph goes here
export async function executeDevWorkflow(
  taskId: string,
  deps: DevWorkflowDependencies
): Promise<DevWorkflowResult> {
  // Existing LangGraph workflow executes as single activity
  return runDevWorkflow(taskId, deps);
}
```
</code_examples>

<sota_updates>
## State of the Art (2024-2025)

What's changed recently:

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Polling-based approvals | Signal-driven workflows | 2023+ | Zero-latency approval delivery, no polling cost |
| Manual state persistence | Temporal durable execution | Standard | Eliminates checkpoint/recovery code |
| LangGraph for everything | Temporal + LangGraph layers | 2024-2025 | Temporal for durability, LangGraph for agent logic |
| Self-hosted Temporal | Temporal Cloud | 2024+ | Lower ops burden, recommended for most teams |

**New tools/patterns to consider:**
- **Temporal Cloud**: Managed service eliminates ops burden, recommended over self-hosted unless strict compliance requirements
- **Temporal Updates (2024)**: Synchronous signal variant with response - useful if approval endpoint needs immediate confirmation
- **Workflow Versioning**: Important for long-running approval workflows that may span code deployments

**Deprecated/outdated:**
- **LangGraph interrupt() for multi-day pauses**: While technically possible with PostgresSaver, not designed for this use case
- **Async activity completion for approvals**: Signals are simpler and more appropriate for human-in-loop
- **Custom retry/timeout handling**: Temporal's declarative approach is better
</sota_updates>

<open_questions>
## Open Questions

Things that couldn't be fully resolved:

1. **Temporal Cloud vs Self-Hosted for MVP**
   - What we know: Cloud is simpler, self-hosted gives full control
   - What's unclear: Whether compliance requirements mandate self-hosted
   - Recommendation: Start with Temporal Cloud free tier (25K actions/month), migrate if needed

2. **Slack Interactive Buttons vs Webhook**
   - What we know: Both can send signals to Temporal
   - What's unclear: Best UX for approve/reject action
   - Recommendation: Plan phase should decide - webhook API endpoint is simpler to start

3. **Workflow ID Strategy**
   - What we know: Workflow IDs should be unique and meaningful
   - What's unclear: Best ID format for correlation with Linear tasks
   - Recommendation: Use `approval-{taskId}` format for clear correlation
</open_questions>

<sources>
## Sources

### Primary (HIGH confidence)
- [Temporal TypeScript SDK Documentation - Message Passing](https://docs.temporal.io/develop/typescript/message-passing) - Signal patterns
- [Temporal TypeScript SDK - Core Application](https://docs.temporal.io/develop/typescript/core-application) - Worker/activity setup
- [Temporal Use Cases and Design Patterns](https://docs.temporal.io/evaluate/use-cases-design-patterns) - Human-in-the-loop overview
- [Learn Temporal - Human-in-the-Loop Tutorial](https://learn.temporal.io/tutorials/ai/building-durable-ai-applications/human-in-the-loop/) - AI agent patterns
- [Temporal TypeScript Samples](https://github.com/temporalio/samples-typescript) - Reference implementations

### Secondary (MEDIUM confidence)
- [Grid Dynamics Migration Case Study](https://temporal.io/blog/prototype-to-prod-ready-agentic-ai-grid-dynamics) - LangGraph → Temporal migration
- [Orchestrating Ambient Agents with Temporal](https://temporal.io/blog/orchestrating-ambient-agents-with-temporal) - Signal patterns for agents
- [Temporal Community - Agentic AI vs Temporal](https://community.temporal.io/t/agentic-ai-lang-graph-vs-temporal-workflows/18371) - Architecture discussion
- [Two-Layer Architecture for Multi-Agent Coordination](https://www.anup.io/temporal-langgraph-a-two-layer-architecture-for-multi-agent-coordination/) - Temporal + LangGraph pattern

### Tertiary (LOW confidence - needs validation)
- General web search results about approval workflow patterns - validated against official docs
</sources>

<metadata>
## Metadata

**Research scope:**
- Core technology: Temporal workflow orchestration
- Ecosystem: @temporalio/* packages, Temporal Cloud
- Patterns: Signal-based approval, activity wrapping, timeout handling
- Pitfalls: Non-determinism, handler race conditions, history growth

**Confidence breakdown:**
- Standard stack: HIGH - Official Temporal SDK, well-documented
- Architecture: HIGH - Based on official tutorials and case studies
- Pitfalls: HIGH - From official docs and community forums
- Code examples: HIGH - Adapted from official SDK documentation

**Research date:** 2026-01-16
**Valid until:** 2026-02-16 (30 days - Temporal SDK is stable)
</metadata>

---

*Phase: 08-human-in-the-loop*
*Research completed: 2026-01-16*
*Ready for planning: yes*

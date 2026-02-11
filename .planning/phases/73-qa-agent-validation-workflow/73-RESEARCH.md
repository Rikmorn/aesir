# Phase 73: QA Agent + Validation Workflow - Research

**Researched:** 2026-02-11
**Domain:** Agent definition (YAML + prompt.md), multi-agent delegation workflow, validation scripting
**Confidence:** HIGH

## Summary

Phase 73 adds a QA agent to the existing Aesir agent fleet and wires a triangular product-dev-QA delegation workflow as the integration test for the entire v2.7 milestone. The research confirms the codebase has all prerequisite infrastructure in place: entity directory with semantic matching, task delegation with handshake, completion signaling with callback routing, shared knowledge with typed entries, and delegation graph observability via the dashboard. The QA agent is a thin orchestrator that runs tests and reviews PR diffs -- two tool calls per invocation -- making it the simplest agent in the system.

The primary technical challenge is the delegation depth limit. `MAX_DELEGATION_DEPTH = 3` with check `parentDepth + 1 >= 3` means the QA-to-dev fix delegation at depth 3 is **blocked** by the current code (depth 2 + 1 = 3 >= 3). This needs to be raised to 5 (or the check changed to `>`) for the fix loop to work as described in the CONTEXT decisions. Everything else is straightforward: create `definitions/qa-agent/`, add one definition.yaml and prompt.md, register capabilities, update `seed-directory.ts`, and write a validation script.

**Primary recommendation:** Plan 73-01 creates the QA agent definition + raises MAX_DELEGATION_DEPTH to 5. Plan 73-02 wires the triangular workflow prompt guidance into dev-agent and product-agent prompts. Plan 73-03 creates the `validate:workflow` script and documents the manual checklist.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### QA Agent Responsibilities
- Two thin checks only: (1) run test command via `codebase:run_command` -- binary exit code pass/fail, (2) read PR diff via GitHub MCP `get_pull_request` and LLM-assess whether it matches the delegation brief
- Requirements source is the delegation brief from `task:delegate` -- the task description + expectations. Not the original Linear ticket, not shared memory (though QA can query for supplementary context)
- No coverage thresholds, no regression detection, no code style/lint checking, no security scanning, no structured test report parsing
- Results communicated via both signal AND shared memory: store findings first (`knowledge:store`, type `test_result`), then signal completion/failure. Memory failure is non-fatal (MEM-09)
- Knowledge entries include: test result type, pass/fail, failed test names (not full output), PR/branch reference, brief summary. Expiry follows `test_result` defaults from MEM-07

#### QA Agent Scope & Targeting
- QA only accepts verification tasks -- capabilities scoped tightly to "verify code changes by running tests and reviewing PR diffs" and "validate implementation against task requirements"
- No artificial "reject if delegator isn't dev-agent" rule -- capabilities and prompt guidance naturally route only verification tasks to QA
- No sub-agents -- QA does all work in its own loop (2-3 tool calls per invocation). Delegation back to dev-agent uses `task:delegate`, not sub-agent spawn

#### Failure-to-Fix Loop
- When QA fails: delegates fix to dev-agent via `task:delegate` with self-contained brief (failed test names + error messages, PR/branch ref, original task description, QA's one-paragraph assessment, relevant knowledge references)
- QA retains ownership: delegates fix, calls `wait_for_task`, resumes on completion signal, re-runs both checks in its own loop
- Fresh delegation for each fix (new conversation, new token budget, clean context). Shared memory bridges implementation context
- Retry limit: delegation depth (DEL-09 max depth 3) naturally caps fix cycles. product(1)->dev(2)->QA(3)->dev-fix(4) uses depth 4. Second fix attempt would hit depth 5 -- rejected by framework
- When depth limit prevents further fixes: QA signals failure up to dev-agent with accumulated context (what was tried, remaining failures). Each level manages its own subtree

#### E2E Validation Approach
- NOT a Vitest test file -- a documented validation procedure with real agents and real LLM calls
- Trigger: `pnpm validate:workflow` script that POSTs a synthetic normalized event to `POST /events` (bypasses Linear, mimics what the adapter would produce)
- Feature request: "Add a /health endpoint that returns { status: 'ok', version: '<package version>' }" -- small, predictable, tests can exist
- Script prints root task ID and dashboard URL, optionally polls task tree API for progress. Human takes over from there
- Required services: PostgreSQL + GitHub integration + agent-service (`docker compose up postgresql github-integration agent-service`). Linear/Slack optional -- graceful degradation handles absent integrations
- Pass criteria: manual checklist verified through dashboard (Phase 75):
  1. Task tree shows full triangle (product->dev->QA, plus fix subtree if triggered)
  2. Handshakes visible -- accept + estimate on each delegation
  3. Signals flow chronologically -- delegation created, accepted, completed
  4. Health indicators green (no orphans, no unresolved timeouts)
  5. Knowledge entries exist (`SELECT * FROM agents.knowledge_entries WHERE type = 'test_result'`)
  6. Conversation links show coherent message history

#### QA Agent Personality & Model
- Voice: skeptical verifier, not adversarial critic. Evidence over opinion, brief is the contract, binary decisiveness
- Reports observed facts (test output, diff contents), not subjective quality judgments
- Minimal communication -- stores findings in knowledge, signals completion/failure. Shortest conversations in the system
- No code suggestions in fix delegation -- QA says what's wrong, dev decides how to fix
- Model: Haiku 4.5 -- QA's work is thin, tool call sequence is near-deterministic, binary decisions. Cost-efficient
- Same sandbox as dev-agent -- `codebase:run_command` targets the same workspace. No separate container

#### QA Agent vs Tester Sub-Agent
- Tester sub-agent: internal to dev-agent, spawned within dev-agent's conversation, shared token budget, runs tests during implementation loop ("does my code work before I commit"). Not in directory
- QA agent: independent orchestrator in entity directory, discovered via `directory:find`, delegated to via `task:delegate`, separate conversation and budget, runs tests as independent verification ("does someone else's code work before I accept"). In directory
- Dev-agent uses tester sub-agent for implementation iteration, delegates to QA for independent verification. DEL-07 guidance: "if it's in your subAgents list, spawn. If you need directory:find, delegate"

### Claude's Discretion
- Exact capability strings for QA agent definition.yaml (verification-specific, not vague)
- QA agent prompt structure and exact wording
- Token budget for QA agent conversations
- Validation script implementation details (polling interval, output format)
- How the synthetic event payload is structured to trigger product-agent

### Deferred Ideas (OUT OF SCOPE)
- Production QA capabilities (coverage analysis, regression detection, continuous monitoring) -- PQA-01, PQA-02, PQA-03
- Comprehensive multi-agent test harness -- PQA-03 (building test infrastructure for multi-agent scenarios is a milestone)
- Product-agent -> QA direct delegation -- future scope if broader QA needs emerge
- QA agent re-architecting suggestions when approach is fundamentally wrong -- out of scope for validation vehicle
</user_constraints>

## Standard Stack

### Core

No new libraries are needed. Phase 73 is entirely additive within the existing stack:

| Component | Version/Location | Purpose | Why Standard |
|-----------|-----------------|---------|--------------|
| Agent Definition YAML | `packages/agents/definitions/qa-agent/definition.yaml` | QA agent configuration (model, tools, capabilities, history) | All agents use this pattern -- AgentRegistry auto-discovers from directory name |
| Prompt Markdown | `packages/agents/definitions/qa-agent/prompt.md` | System prompt following PROMPT_GUIDE.md structure | Standard raw-text prompt file, no TypeScript encoding |
| `seed-directory.ts` | `packages/agents/scripts/seed-directory.ts` | Seeds QA agent into entity_directory with capability embeddings | Existing idempotent seeding script, needs no modification -- auto-discovers definitions with `capabilities` field |
| `tool-factories.ts` | `packages/agents/src/framework/tool-factories.ts` | Already registers all 47 tools QA needs | No new tools required -- QA uses existing `codebase:run_command` + `github:get_pull_request` |
| `tsx` | `packages/agents/package.json` scripts | Validation script runner | Already a devDependency, used for `seed-directory.ts` |

### Supporting

| Component | Purpose | When to Use |
|-----------|---------|-------------|
| `nanoid` (already dep) | Generate synthetic event IDs (`evt_<nanoid>`) | Validation script needs to create a well-formed NormalizedEvent |
| `node:http` (stdlib) | POST to `localhost:3004/events` | Validation script trigger -- no external deps needed |

### Alternatives Considered

None -- this phase uses only existing infrastructure. No new libraries.

## Architecture Patterns

### Recommended Project Structure

```
definitions/
  qa-agent/
    definition.yaml    # Model, tools, capabilities (NEW)
    prompt.md          # System prompt (NEW)

scripts/
  validate-workflow.ts # Validation script (NEW)
```

### Pattern 1: Agent Definition YAML

**What:** Declarative agent configuration validated by Zod against `AgentDefinitionYamlSchema`.

**When to use:** Creating any new agent. The `id` field MUST match the directory name.

**Example from existing dev-agent:**

```yaml
id: qa-agent
name: QA Verifier
description: >
  Independent verification agent that validates code changes by running
  tests and reviewing PR diffs against task requirements.
version: "1"

model: claude-haiku-4-5-20251001
temperature: 0

tools:
  - codebase:run_command          # Run tests in dev container
  - codebase:read_file            # Read test files for context
  - github:get_pull_request       # Fetch PR diff for review
  - task:respond                  # Accept/reject delegation handshake
  - task:complete_task            # Signal task completion
  - task:delegate                 # Delegate fix to dev-agent
  - task:get_task_context         # Read delegator's context
  - task:list_tasks               # View task hierarchy
  - coordination:wait_for         # Wait for handshake signals
  - coordination:wait_for_task    # Wait for fix completion
  - knowledge:store               # Store test results
  - knowledge:query               # Query prior test results
  - directory:find                # Find dev-agent for fix delegation
  - directory:get                 # Verify entity details

capabilities:
  - "verify code changes by running tests and reviewing PR diffs"
  - "validate implementation against task requirements"

maxIterations: 15
tokenBudget: 30000

history:
  pruneThreshold: 20000
  protectedMessages: 10
  summaryThreshold: 30000
  summaryModel: claude-haiku-4-5-20251001
```

**Source:** Existing agent definitions in `packages/agents/definitions/*/definition.yaml` (HIGH confidence -- read directly from codebase).

### Pattern 2: Delegation Handshake (Target Agent Side)

**What:** QA agent receives a `<delegation>` XML block and must respond via `task:respond`.

**When to use:** When the QA agent starts -- its initial message is the delegation block.

**Example delegation block received by QA:**

```xml
<delegation task_id="tsk_abc123" from="dev-agent" depth="2" max_depth="5">
Verify the following implementation:

Branch: feature/add-health-endpoint
PR: #42 (owner/repo)

Requirements:
- /health endpoint returns { status: 'ok', version: '<package version>' }
- Tests exist and pass

Run the project's test suite and review the PR diff. Signal completion
if both checks pass. Signal failure with failed test names if tests fail.
</delegation>
```

**Source:** `packages/agents/src/shared/tools/task/delegate-task.ts` line 47-57 (`buildDelegationBlock` function) (HIGH confidence).

### Pattern 3: Synthetic NormalizedEvent for Validation

**What:** POST a fabricated `NormalizedEvent` to `POST /events` that mimics a Slack `app_mention` triggering product-agent.

**When to use:** `validate:workflow` script to start the triangular flow without requiring actual Slack.

**Example payload:**

```typescript
const event = {
  id: `evt_${nanoid()}`,
  type: "slack.app_mention.created",
  source: "slack" as const,
  timestamp: new Date().toISOString(),
  correlationId: `validate_${nanoid()}`,
  payload: {
    text: "Add a /health endpoint that returns { status: 'ok', version: '<package version>' }",
    channel: "C_SYNTHETIC",
    user: "U_VALIDATION",
    ts: `${Date.now() / 1000}`,
    teamId: "T_SYNTHETIC",
  },
};
```

**Source:** `NormalizedEventSchema` in `packages/types/src/events/schema.ts` + `adaptSlackEvent` in `packages/agents/src/adapters/slack.ts` (HIGH confidence -- validated against Zod schema and adapter handling).

### Pattern 4: QA Prompt Structure (Following PROMPT_GUIDE.md)

**What:** Identity + constraints + domain_knowledge + tools + context structure.

**When to use:** Writing the QA agent's prompt.md.

**Key rules from PROMPT_GUIDE.md:**
- Goal-oriented identity, not procedural
- Constitutional constraints (what NOT to do)
- Few-shot examples with reasoning
- Minimize directive density
- No state machines in natural language
- Trust the model for intent detection

**QA is special:** It is an orchestrator (appears in directory, delegates work), so it should externalize reasoning in `<reasoning>` blocks. But its conversations are the shortest in the system, so prompts should be correspondingly terse.

**Source:** `packages/agents/definitions/PROMPT_GUIDE.md` (HIGH confidence -- read directly).

### Anti-Patterns to Avoid

- **Encoding test analysis logic in the prompt:** QA does not parse test output or categorize failures. It reads exit code (pass/fail) and delegates fix briefs with raw failure context. The tester sub-agent already has categorization logic -- QA is a delegation orchestrator, not a test analyst.
- **Adding new tools for QA:** No new tool factories needed. QA uses `codebase:run_command` (same as tester sub-agent) and `github:get_pull_request` (same as dev-agent). Adding QA-specific tools would violate the "thin validation vehicle" scope.
- **Hardcoding delegator checks:** No `if (delegator !== 'dev-agent') reject` logic. Capability-based routing via directory:find naturally routes only verification tasks to QA. The prompt can express preference but should not encode rules.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| QA-specific test runner tool | Custom `qa:run_tests` tool | `codebase:run_command` | Same Docker sandbox, same shell access. Exit code is sufficient for pass/fail. |
| PR diff parser | Custom diff analysis tool | `github:get_pull_request` | Returns title, body, changed files, review state. LLM-assessing against the brief is the QA agent's job. |
| Delegation orchestration code | Custom QA-specific workflow code | Existing `task:delegate` + `wait_for_task` + `task:respond` + `task:complete_task` | The entire delegation lifecycle is already implemented in Phase 70-74 tools. |
| Entity directory registration | Custom seed script for QA | Existing `seed-directory.ts` | Auto-discovers definitions with `capabilities` field. Just adding `capabilities` to definition.yaml is sufficient. |

**Key insight:** Phase 73 adds ZERO new framework code. The entire implementation is: one YAML file, one prompt.md, one validation script, and prompt updates to dev-agent/product-agent.

## Common Pitfalls

### Pitfall 1: MAX_DELEGATION_DEPTH Blocks QA Fix Loop

**What goes wrong:** With `MAX_DELEGATION_DEPTH = 3` and check `parentDepth + 1 >= 3`, the QA-to-dev fix delegation is blocked. The delegation chain product(depth 0)->dev(depth 1)->QA(depth 2)->dev-fix attempts depth 3, but `2 + 1 >= 3` = true = rejected.

**Why it happens:** The CONTEXT.md describes depths as product(1)->dev(2)->QA(3)->dev-fix(4), implying at least depth 4 should be allowed. The current `MAX_DELEGATION_DEPTH = 3` in `packages/agents/src/shared/tools/task/types.ts` line 39 blocks this.

**How to avoid:** Raise `MAX_DELEGATION_DEPTH` from 3 to 5. This allows:
- Depth 0: product root task
- Depth 1: product->dev delegation
- Depth 2: dev->QA delegation
- Depth 3: QA->dev fix delegation (first fix)
- Depth 4: QA->dev second fix attempt (if first fix fails and QA retries)

Value 5 gives room for one full fix cycle with a safety margin. The dashboard's health computation (`depthLimitReached: nodes.some(n => n.depth >= 3)`) in `packages/dashboard/src/services/tasks.ts` line 312 also needs updating to match.

**Warning signs:** `task:delegate` returns "Delegation depth limit reached" error during QA->dev fix delegation.

**Files to update:**
- `packages/agents/src/shared/tools/task/types.ts` -- change `MAX_DELEGATION_DEPTH = 3` to `5`
- `packages/dashboard/src/services/tasks.ts` line 312 -- change `n.depth >= 3` to `n.depth >= 5`
- `packages/agents/src/shared/tools/task/delegate-task.ts` -- no change needed (reads from constant)

### Pitfall 2: QA Agent Not Appearing in Directory After Deploy

**What goes wrong:** QA agent definition.yaml has `capabilities` field, but `directory:find` returns no results for QA.

**Why it happens:** The `seed-directory.ts` script must be re-run after adding the QA agent definition. The seeder reads definitions from disk, generates capability embeddings via the embedding service, and upserts into `entity_directory`. Without re-seeding, QA has no directory entry.

**How to avoid:** The validation procedure must include `pnpm --filter @aesir/agents seed:directory` as a prerequisite step. The seeder is idempotent (ON CONFLICT DO UPDATE) and auto-discovers new definitions.

**Warning signs:** `directory:find` with "verify code changes" returns zero results.

### Pitfall 3: Synthetic Event Rejected by NormalizedEventSchema

**What goes wrong:** The validation script's synthetic event fails Zod validation at `POST /events`.

**Why it happens:** `NormalizedEventSchema` requires:
- `id` starting with `evt_`
- `type` matching regex `^(linear|github|slack)\.[a-z_]+\.[a-z_]+$`
- `source` as one of `["linear", "github", "slack"]`
- `timestamp` as ISO datetime string
- `correlationId` as string

Any deviation causes a 400 response with validation issues.

**How to avoid:** Construct the event exactly matching the schema. Use `slack.app_mention.created` type with `source: "slack"` since product-agent triggers on that event type.

**Warning signs:** `POST /events` returns 400 with `{ error: "Validation failed", issues: [...] }`.

### Pitfall 4: Product-Agent Creating Linear Issues Without Linear Integration

**What goes wrong:** The triangular workflow stalls because product-agent tries to call `linear:create_issue` but the Linear integration is not running.

**Why it happens:** Product-agent's core loop involves creating Linear issues. With `docker compose up postgresql github-integration agent-service` (no linear-integration), the MCP call to Linear fails.

**How to avoid:** Two options:
1. Accept that product-agent may fail on Linear tools and document this in the validation checklist as expected behavior (graceful degradation test)
2. Also start `linear-integration` in the required services

The CONTEXT says "Linear/Slack optional -- graceful degradation handles absent integrations." So option 1 is the intended path. But the product-agent prompt may need guidance to handle Linear tool failures gracefully (or the product-agent's job in this flow is just delegating to dev-agent, not creating Linear issues).

**Warning signs:** Product-agent conversation fails with MCP connection errors to `linear-integration:3001`.

### Pitfall 5: QA Agent Sandbox Not Available

**What goes wrong:** QA agent's `codebase:run_command` returns "No dev container available" because no sandbox was provisioned for the QA conversation.

**Why it happens:** The QA agent's conversation is started via `executor.start()` from `task:delegate`. The sandbox (dev container) is provisioned by the worker loop for agents that have `codebase:*` tools. BUT the sandbox is per-conversation -- QA gets its own conversation, which needs its own sandbox setup.

**How to avoid:** The worker loop already provisions sandboxes for any agent with codebase tools (if `sandboxManager` + `sandboxSetup` are configured in `ConversationExecutorOptions`). The QA agent definition includes `codebase:run_command` and `codebase:read_file`, so the worker loop SHOULD provision a sandbox. But the sandbox setup clones the repo from scratch. QA needs the dev-agent's branch and changes.

This is resolved by the CONTEXT decision: "Same sandbox as dev-agent." But the current architecture creates per-conversation sandboxes. QA sharing the dev container requires either: (a) sandboxId passed through the delegation, or (b) QA clones the repo and checks out the feature branch.

Option (b) is simpler: QA's sandbox clones the same repo, and QA runs `git checkout <branch>` before running tests. The delegation brief includes the branch name, which QA uses to set up.

**Warning signs:** `run_command` returns "No dev container available" or tests fail because the branch doesn't have the dev-agent's changes.

### Pitfall 6: Validation Script Assumes Services Are Ready

**What goes wrong:** `pnpm validate:workflow` starts but `POST /events` fails because agent-service isn't fully bootstrapped.

**Why it happens:** Docker services take time to start. The agent service needs PostgreSQL ready, migrations run, and directory seeded before it can route events.

**How to avoid:** The validation script should include a health check loop (poll `GET /health` on localhost:3004) before posting the synthetic event.

**Warning signs:** ECONNREFUSED or 500 errors on the initial event POST.

## Code Examples

### Example 1: QA Agent definition.yaml

```yaml
id: qa-agent
name: QA Verifier
description: >
  Independent verification agent that validates code changes by running
  tests and reviewing PR diffs against delegation requirements.
version: "1"

model: claude-haiku-4-5-20251001
temperature: 0

tools:
  - codebase:run_command
  - codebase:read_file
  - github:get_pull_request
  - task:respond
  - task:complete_task
  - task:delegate
  - task:get_task_context
  - task:list_tasks
  - coordination:wait_for
  - coordination:wait_for_task
  - knowledge:store
  - knowledge:query
  - directory:find
  - directory:get
  - communication:reply
  - communication:notify

capabilities:
  - "verify code changes by running tests and reviewing PR diffs"
  - "validate implementation against task requirements"

maxIterations: 15
tokenBudget: 30000

history:
  pruneThreshold: 20000
  protectedMessages: 10
  summaryThreshold: 30000
  summaryModel: claude-haiku-4-5-20251001
```

**Source:** Pattern from existing `dev-agent/definition.yaml`, `tester/definition.yaml`, `product-agent/definition.yaml` (HIGH confidence -- direct codebase patterns).

### Example 2: Validation Script Structure

```typescript
#!/usr/bin/env tsx
/**
 * Validate Triangular Workflow
 *
 * Posts a synthetic event to trigger product-agent, which should:
 * 1. Delegate implementation to dev-agent
 * 2. Dev-agent implements and delegates verification to QA
 * 3. QA runs tests and reviews PR diff
 * 4. If tests fail, QA delegates fix to dev-agent
 * 5. Full task tree visible in dashboard
 *
 * Run: pnpm --filter @aesir/agents validate:workflow
 * Required: docker compose up postgresql github-integration agent-service
 */

import { loadEnvFromRoot } from "@aesir/platform";
loadEnvFromRoot();

import { nanoid } from "nanoid";

const AGENT_SERVICE_URL = process.env.AGENT_SERVICE_URL || "http://localhost:3004";
const DASHBOARD_URL = process.env.DASHBOARD_URL || "http://localhost:3005/dashboard";

async function waitForHealth(url: string, maxWaitMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) return;
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error(`Service at ${url} not healthy after ${maxWaitMs}ms`);
}

async function main() {
  console.log("Waiting for agent-service health...");
  await waitForHealth(AGENT_SERVICE_URL);

  const correlationId = `validate_${nanoid()}`;
  const event = {
    id: `evt_${nanoid()}`,
    type: "slack.app_mention.created",
    source: "slack",
    timestamp: new Date().toISOString(),
    correlationId,
    payload: {
      text: "Add a /health endpoint that returns { status: 'ok', version: '<package version>' }",
      channel: "C_SYNTHETIC",
      user: "U_VALIDATION",
      ts: `${Date.now() / 1000}`,
      teamId: "T_SYNTHETIC",
    },
  };

  console.log("\nPosting synthetic event...");
  const response = await fetch(`${AGENT_SERVICE_URL}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });

  const result = await response.json();
  console.log("Route result:", JSON.stringify(result, null, 2));

  if (result.conversationId) {
    console.log(`\nRoot conversation: ${result.conversationId}`);
    console.log(`Dashboard: ${DASHBOARD_URL}/conversations/${result.conversationId}`);
  }

  console.log("\n--- Manual Verification Checklist ---");
  console.log("1. [ ] Task tree shows full triangle in dashboard");
  console.log("2. [ ] Handshakes visible (accept + estimate)");
  console.log("3. [ ] Signals flow chronologically");
  console.log("4. [ ] Health indicators green");
  console.log("5. [ ] Knowledge entries: SELECT * FROM agents.knowledge_entries WHERE type = 'test_result'");
  console.log("6. [ ] Conversation links show coherent history");
}

main().catch(err => {
  console.error("Validation failed:", err);
  process.exit(1);
});
```

**Source:** Pattern from existing `scripts/seed-directory.ts` + `NormalizedEventSchema` + `POST /events` route in `service/main.ts` (HIGH confidence).

### Example 3: Dev-Agent Prompt Addition for QA Delegation

The dev-agent prompt needs guidance about when to delegate verification to QA:

```markdown
## Independent Verification

After creating a pull request, delegate verification to a QA agent via directory:find + task:delegate.
The QA agent runs tests and reviews the PR diff independently -- it cannot see your conversation.

Your delegation brief should include:
- Branch name and PR number
- What the tests should verify (from the original requirements)
- The test command to run (e.g., "pnpm test" or a specific test file)

If QA reports test failures, you receive a fix delegation back. The brief will include
failed test names and QA's assessment. Fix the issues, commit, and complete the task --
QA will re-verify automatically.
```

**Source:** Existing delegation guidance in dev-agent prompt.md (HIGH confidence -- extends existing pattern).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No delegation | task:delegate + directory:find | Phase 70-72 (v2.7) | QA delegation uses this existing infra |
| Static agent assignment | Semantic capability matching via pgvector | Phase 72 | QA is discovered by capability, not hardcoded |
| No shared memory | knowledge:store/query | Phase 71 | QA stores test results for cross-conversation persistence |
| No completion signaling | TaskSignalDispatcher | Phase 74 | QA completion/failure signals automatically routed to delegator |

## Open Questions

### 1. Product-Agent Role in Validation

**What we know:** Product-agent triggers on `slack.app_mention.created` and creates Linear issues. The validation wants product-agent to delegate to dev-agent.

**What's unclear:** Product-agent's current prompt and tools focus on issue creation, not delegation for implementation. The product-agent has `task:delegate` and `directory:find`, but its prompt does not have strong guidance about delegating implementation work after issue creation. Will the LLM figure this out from the delegation tools' descriptions alone?

**Recommendation:** Add delegation guidance to product-agent's prompt (similar to what dev-agent already has). The product-agent needs to: (a) interpret the feature request, (b) delegate implementation to dev-agent via `directory:find` + `task:delegate`, (c) wait for completion. This may need to be a focused prompt addition in plan 73-02. Alternatively, if product-agent reliably delegates with just the tool descriptions and existing examples, no prompt change is needed -- test this during validation.

### 2. Sandbox Sharing Between Dev and QA

**What we know:** The CONTEXT says "Same sandbox as dev-agent." The current architecture creates per-conversation sandboxes via the worker loop.

**What's unclear:** How does QA access the dev-agent's branch? The sandbox setup clones from `config.github.repoUrl`. QA's sandbox would clone the same repo but needs to checkout the feature branch created by dev-agent.

**Recommendation:** QA's delegation brief includes the branch name. QA's first tool call should be `codebase:run_command` with `git checkout <branch>` before running tests. This works because both sandboxes clone the same repo, and the feature branch exists on the remote (dev-agent pushed via GitHub MCP). No sandbox sharing infrastructure needed.

### 3. Validation Without Slack/Linear

**What we know:** The CONTEXT says Linear/Slack are optional, and the synthetic event mimics a Slack app_mention. Product-agent has communication tools (reply, ask, notify) that route to Slack.

**What's unclear:** Will product-agent's communication tool calls fail silently or crash the conversation when Slack integration is unreachable?

**Recommendation:** Communication tools use MCP HTTP calls with retry logic. Unreachable integrations should cause tool errors (not conversation crashes). Product-agent's prompt already has: "If you lack the tools or permissions to do what was asked, say so clearly." The validation should document that Slack communication failures are expected and non-fatal. Test this during validation -- if communication failures crash conversations, that's a separate bug to fix.

## Sources

### Primary (HIGH confidence)
- `packages/agents/definitions/dev-agent/definition.yaml` -- agent definition pattern
- `packages/agents/definitions/product-agent/definition.yaml` -- orchestrator agent pattern with capabilities
- `packages/agents/definitions/tester/definition.yaml` -- Haiku model + thin tool set pattern
- `packages/agents/definitions/PROMPT_GUIDE.md` -- prompt authoring rules
- `packages/agents/src/framework/types.ts` -- AgentDefinitionYamlSchema (capabilities field, tool ref format)
- `packages/agents/src/framework/tool-factories.ts` -- all 47 registered tools (no new tools needed)
- `packages/agents/src/framework/agent-registry.ts` -- auto-discovery from directory name
- `packages/agents/src/shared/tools/task/delegate-task.ts` -- delegation flow, depth checking
- `packages/agents/src/shared/tools/task/types.ts` -- MAX_DELEGATION_DEPTH = 3 (needs raising)
- `packages/agents/src/shared/tools/task/respond-task.ts` -- handshake target-side implementation
- `packages/agents/src/shared/tools/task/complete-task.ts` -- completion signaling trigger
- `packages/agents/src/shared/services/task-signal-dispatcher.ts` -- callback routing through parent task
- `packages/agents/src/shared/services/directory-service.ts` -- semantic matching with pgvector
- `packages/agents/src/shared/tools/knowledge/store.ts` -- knowledge store with typed entries
- `packages/agents/src/shared/tools/knowledge/types.ts` -- `test_result` type (7d expiry)
- `packages/agents/src/shared/tools/codebase/run-command.ts` -- shell command execution in sandbox
- `packages/agents/src/shared/tools/integration/github-tools.ts` -- get_pull_request tool
- `packages/agents/scripts/seed-directory.ts` -- idempotent directory seeding from YAML
- `packages/agents/src/service/main.ts` -- service bootstrap, POST /events route
- `packages/agents/src/adapters/slack.ts` -- slack.app_mention.created adapter
- `packages/types/src/events/schema.ts` -- NormalizedEventSchema
- `packages/dashboard/src/services/tasks.ts` -- task tree, timeline, health computation

### Secondary (MEDIUM confidence)
- `.planning/specs/2.7-agent-collaboration.md` -- Phase 76 (QA Agent) spec, requirements QA-01 through QA-07
- `.planning/phases/73-qa-agent-validation-workflow/73-CONTEXT.md` -- user decisions and constraints

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, entirely existing infrastructure
- Architecture: HIGH -- follows established agent definition patterns, no novel patterns needed
- Pitfalls: HIGH -- depth limit issue verified by reading actual code (`parentDepth + 1 >= MAX_DELEGATION_DEPTH`), sandbox and validation issues derived from architectural understanding

**Research date:** 2026-02-11
**Valid until:** 2026-03-11 (stable -- internal codebase patterns, no external dependencies to drift)

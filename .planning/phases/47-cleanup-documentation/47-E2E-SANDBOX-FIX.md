# Phase 47: E2E Sandbox Fix — DevContainerManager Wiring

**Discovered:** 2026-02-03 (dev-agent E2E testing)
**Status:** Fix implemented, tests passing, deployed to local Docker

## Discovery

During dev-agent E2E testing, all 5 codebase tools returned:
```
"No dev container available. This tool requires a running dev container."
```

The dev-agent correctly fetched the Linear issue (ON-1139) but couldn't access the codebase. It escalated via `request_human_input` and paused with `wait_for` type `escalation_resolved`.

## Root Cause

Phase 44 (unified service consolidation) created `service/main.ts` but never instantiated `DevContainerManager` from `@aesir/platform`. The wiring gap spans 4 levels:

1. `main.ts` — never creates a sandbox/container manager
2. `ConversationExecutorOptions` — no field to accept it
3. `WorkerLoopOptions` — no field to accept it
4. `worker-loop.ts:288-292` — `ToolContext` built without `containerManager` or `taskId`

Additionally, no container spawn or repo clone logic existed anywhere in the execution pipeline.

## Phase 45 Workaround

Phase 45 (integration testing) discovered that codebase tools crashed when `containerManager` was undefined. Rather than fixing the root cause, defensive guards were added to all 5 tools:

```typescript
if (!containerManager) {
  return { content: "No dev container available...", isError: true };
}
```

This was documented in `45-E2E-FIXES.md` as "Fix 2: Codebase tools crash with undefined containerManager" — a symptom fix, not a root cause fix.

## Fix: SandboxManager Wiring

### Abstraction

Introduced `type SandboxManager = DevContainerManager` as a type alias in the agents framework. This decouples the framework from the Docker-specific implementation:

- New code (executor options, worker loop) references `SandboxManager`
- Existing `ToolContext.containerManager` field keeps its name (avoids touching all codebase tools)
- To swap from Docker to Fargate/Lambda, only change the factory call in `main.ts`
- The `DevContainerManager` interface methods (spawn, execute, health, close) are backend-agnostic

### Files Changed

| File | Change |
|------|--------|
| `shared/env/config.ts` | Expose `GITHUB_REPO_URL`, `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_BASE_BRANCH` in structured config |
| `framework/types.ts` | Add `SandboxManager` type alias, `sandboxManager` + `sandboxSetup` to `ConversationExecutorOptions` |
| `framework/worker-loop.ts` | Add `sandboxManager` + `sandboxSetup` to `WorkerLoopOptions`, `setupSandbox()` helper, ToolContext population |
| `framework/conversation-executor.ts` | Pass `sandboxManager` + `sandboxSetup` through to worker loop |
| `service/main.ts` | Create `DevContainerManager`, wire to executor, add to shutdown sequence |
| `framework/worker-loop.test.ts` | Tests for sandbox spawn, skip, failure, ToolContext population |

### setupSandbox Helper

New function in worker-loop.ts that:
1. Spawns container (reuses if already running — handles resume case)
2. Checks if repo already cloned (`test -d /workspace/repo/.git`)
3. Configures git credentials if GitHub token available
4. Clones repository via `DevContainerGit.cloneRepository()`

Called eagerly before the agent loop for agents with `codebase:*` tools.

### Design Decisions

- **taskId = conv.id**: Each conversation attempt gets its own container. Clean state on retries.
- **Eager spawn**: Agents with codebase tools will always use them. Fail early if container can't spawn.
- **Container cleanup delegated**: DevContainerCleanup service handles idle containers independently.
- **Sub-agent sharing deferred**: `spawn_agent` not yet wired. Will add `parent_conversation_id` taskId derivation when implemented.

## Also Found: Message Persistence Bug

During the same E2E session, discovered that agent loop messages were not persisted at lifecycle boundaries. `worker-loop.ts:452` set `finalMessages = currentMessages` (pre-loop state). The agent loop's accumulated messages (LLM responses, tool calls, tool results) were lost.

**Fix**: Added `messages: Anthropic.MessageParam[]` to `AgentLoopResult`, returned `conversationMessages` from all 10 exit paths in `run-agent-loop.ts`, combined pre-loop + loop messages in worker-loop.ts.

**Verification**: DB showed 21 messages (10.6KB) persisted after fix, vs 1 message (105 bytes) before.

## Implementation Status

- [x] `shared/env/config.ts` — GitHub vars exposed in structured config
- [x] `framework/types.ts` — `SandboxManager` alias + executor options
- [x] `framework/worker-loop.ts` — `setupSandbox` helper + ToolContext wiring
- [x] `framework/conversation-executor.ts` — passthrough to worker loop
- [x] `service/main.ts` — create `DevContainerManager`, wire to executor, shutdown
- [x] `framework/worker-loop.test.ts` — 9 new sandbox tests (45 total, all passing)
- [x] Typecheck clean (317 framework tests passing)
- [x] Agent-service rebuilt and redeployed (`docker compose build && up -d`)
- [x] E2E verified — dev-agent used `list_directory`, `search_codebase`, `read_file` against live sandbox (27 messages / 18KB persisted, `platform.dev_containers` row created)

---

*Documented: 2026-02-03, E2E verified: 2026-02-03*

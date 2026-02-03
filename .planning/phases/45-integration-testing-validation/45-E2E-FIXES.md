# Phase 45: E2E Edge Case Fixes

Three edge cases identified during manual E2E validation that need fixing before Phase 46.

## Fix 1: Timeout signal type mismatch (PRIORITY)

**Problem:** TimeoutScheduler sends `type: "wait_timeout"` but the agent's `wait_for` registers a specific type like `"approval"`. The worker loop's signal matching checks `signal.type === pendingWait.type`, so the timeout signal never matches and the conversation stays paused forever.

**Root cause:** `timeout-scheduler.ts:170-176` hardcodes `type: "wait_timeout"` in the signal. The worker loop's `checkQueuedSignals` and the executor's `signal()` method both compare `signal.type` against `pending_wait.type`.

**Fix approach:** The timeout signal should use the *original* wait type so it matches the pending wait. The `wait_timeout` semantic should be communicated via a different field (e.g., `data.timeout: true` or a `source: "internal:scheduler"` check). Two options:

- **Option A (simpler):** Change `timeout-scheduler.ts` to send `type: waitType` (the original wait type) instead of `type: "wait_timeout"`. The signal's `source: "internal:scheduler"` and `data.originalWaitType` already identify it as a timeout. The agent sees it as a matching signal with timeout context in the message/data fields.
- **Option B:** Change the worker loop and executor signal matching to treat `wait_timeout` as a wildcard that matches any pending wait type. More complex, touches more code.

**Recommendation:** Option A -- minimal change, semantically correct (a timeout IS the signal the agent was waiting for).

**Files to modify:**
- `packages/agents/src/framework/timeout-scheduler.ts` -- change `type: "wait_timeout"` to `type: waitType`
- `packages/agents/src/framework/timeout-scheduler.test.ts` -- update test expectations
- `packages/agents/src/framework/__integration__/lifecycle-flows.integration.test.ts` -- remove the workaround comment about manual timeout simulation (the real mechanism now works)

**Verification:** The integration test for Flow 3 (timeout) should work with real TimeoutScheduler signal delivery instead of manual simulation. However, pg-boss delayed jobs require actual time to pass, so integration tests may still need to use direct executor.signal() with the correct type.

## Fix 2: Codebase tools crash with undefined containerManager

**Problem:** When `containerManager` is undefined (no dev container running), codebase tools throw `TypeError: Cannot read properties of undefined (reading 'execute')`. The error IS caught by each tool's try/catch, but it logs a noisy TypeError stack trace instead of a clean error message.

**Root cause:** Tool factory functions (`list-directory.ts`, `read-file.ts`, `write-file.ts`, `execute-command.ts`, `search-codebase.ts`) destructure `deps.containerManager` but don't guard against it being undefined before calling `.execute()`.

**Fix approach:** Add an early return in each codebase tool's `execute()` method:

```typescript
if (!containerManager) {
  return {
    content: "No dev container available. This tool requires a running dev container.",
    isError: true,
  };
}
```

**Files to modify:**
- `packages/agents/src/shared/tools/codebase/list-directory.ts`
- `packages/agents/src/shared/tools/codebase/read-file.ts`
- `packages/agents/src/shared/tools/codebase/write-file.ts`
- `packages/agents/src/shared/tools/codebase/execute-command.ts`
- `packages/agents/src/shared/tools/codebase/search-codebase.ts`

**Verification:** Start a conversation without a dev container, verify clean error messages in logs (no TypeError stack traces).

## Fix 3: Signal to terminal conversation returns misleading HTTP response

**Problem:** `POST /events` with a signal targeting a cancelled/completed conversation returns `{"received":true,"action":"signaled"}` even though the executor rejected the signal internally. The HTTP response doesn't distinguish between successful and rejected signals.

**Root cause:** `packages/agents/src/router/router.ts:131-135` always returns `action: "signaled"` regardless of the executor's signal result.

**Fix approach:** Return the actual signal action in the response body:

```typescript
case "signal": {
  const signalResult = await deps.executor.signal(
    routeDecision.conversationId,
    routeDecision.signal,
  );
  // ... logging ...
  return {
    received: true,
    action: signalResult.action,  // "resumed" | "queued" | "rejected" | "deduplicated"
    conversationId: routeDecision.conversationId,
  };
}
```

Note: HTTP status should remain 200 (webhook callers need ack), but the response body accurately reflects what happened.

**Files to modify:**
- `packages/agents/src/router/router.ts` -- change `action: "signaled"` to `action: signalResult.action`
- `packages/agents/src/router/types.ts` -- update `RouteEventResult.action` type to include signal result actions
- `packages/agents/src/framework/__integration__/http-layer.integration.test.ts` -- update signal test expectations if needed

**Verification:** Send signal to cancelled conversation via `POST /events`, verify response contains `action: "rejected"`.

## Status

| Fix | Priority | Status | Commit |
|-----|----------|--------|--------|
| 1. Timeout signal type mismatch | HIGH | Complete | da866cb |
| 2. Codebase tools undefined guard | MEDIUM | Complete | 029d263 |
| 3. Signal response accuracy | LOW | Complete | 11e5b5b |

---
*Created: 2026-02-03 -- Post E2E validation edge case fixes*

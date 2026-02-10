/**
 * Signal Matching Helper
 *
 * Shared signal matching logic used by both conversation-executor.ts (for
 * signal delivery to waiting conversations) and worker-loop.ts (for queued
 * signal consumption before/after agent loop execution).
 *
 * Handles backward compatibility with both old-format pending_wait
 * (`{ type: string }`) and new-format (`{ types: string[] }`).
 *
 * For wait_for_task, supports taskId-scoped matching via
 * `pendingWait.metadata.taskId` -- prevents cross-task signal wakeup.
 */

/**
 * Check whether an incoming signal matches a conversation's pending wait.
 *
 * @param signal - The incoming signal with at least a `type` and optional `data`
 * @param pendingWait - The stored pending_wait JSONB from the conversations table
 * @returns true if the signal should wake this conversation
 */
export function signalMatchesPendingWait(
  signal: { type: string; data?: Record<string, unknown> | undefined },
  pendingWait: Record<string, unknown> | null | undefined,
): boolean {
  if (!pendingWait) return false;

  // Normalize: support both old `type` (string) and new `types` (string[]) format
  const types = pendingWait.types
    ? (pendingWait.types as string[])
    : pendingWait.type
      ? [pendingWait.type as string]
      : [];

  if (types.length === 0) return false;

  // Type membership check
  if (!types.includes(signal.type)) return false;

  // TaskId-scoped matching: if the pending wait was created by wait_for_task,
  // the signal must carry the same taskId in its data payload.
  const metadata = pendingWait.metadata as
    | Record<string, unknown>
    | null
    | undefined;
  if (metadata?.taskId) {
    const signalTaskId = signal.data?.taskId;
    if (signalTaskId !== metadata.taskId) return false;
  }

  return true;
}

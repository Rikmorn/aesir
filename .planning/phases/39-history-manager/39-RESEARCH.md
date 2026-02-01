# Phase 39: History Manager - Research

**Researched:** 2026-02-01
**Domain:** LLM conversation context management, tool output pruning, structured summarization
**Confidence:** HIGH

## Summary

This phase implements a two-phase conversation compaction system (Phase 1: pruning, Phase 2: summarization) that operates on the `Anthropic.MessageParam[]` array managed by `runAgentLoop()`. The History Manager is a pure function called before each LLM call within the agent loop, reading history config from the agent definition YAML (already defined in Phase 38) and artifacts from the `agent_sessions` projection (already built in Phase 37).

The research confirms that Anthropic provides a free server-side token counting API (`client.messages.countTokens()`) which returns exact token counts matching billing. However, for the hot path (called before every LLM call), a character-based approximation (1 token ~= 4 characters) is the right choice for Phase 1 threshold checks, with the exact API reserved for Phase 2 summary validation. This follows the OpenCode pattern where `Token.estimate()` is used for pruning decisions to avoid expensive tokenization. The Anthropic server-side `context_management.edits.clear_tool_uses_20250919` beta feature exists and does something similar to Phase 1 pruning, but is NOT suitable here because (a) it is in beta, (b) it cannot do head+tail preservation, deduplication, or tool-type-tiered replacement, and (c) it operates server-side without client visibility into what was cleared.

The JetBrains NeurIPS 2025 paper "The Complexity Trap" validates the Phase 1-first strategy: observation masking (equivalent to our pruning) matched LLM summarization quality at lower cost, and summarization actually caused agents to run 13-15% longer. This supports the user's decision to build both phases but treat Phase 1 as the primary strategy.

**Primary recommendation:** Build History Manager as a stateless `compactHistory()` function that takes messages, config, and optional session artifacts, returning a compacted messages array. Phase 1 prunes tool results in-place. Phase 2 calls an LLM for summarization only when Phase 1 is insufficient. Use character-based token estimation for threshold checks, Anthropic's countTokens API for post-summary validation.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@anthropic-ai/sdk` | ^0.72.0 | Token counting via `client.messages.countTokens()`, LLM calls for summarization | Already in project, provides free exact token counting |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none) | - | Character-based token estimation | Hot-path threshold checks where API latency is unacceptable |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Character-based estimation | `@anthropic-ai/tokenizer` | Beta, not accurate for Claude 3+, adds dependency |
| Character-based estimation | tiktoken (`p50k_base`) | Python-native, poor Node.js support, only approximate |
| Client-side pruning | Anthropic `context_management` beta | Server-side, no head+tail, no dedup, no visibility into what was cleared |
| Custom summarization | SDK `compaction_control` | Requires `tool_runner` which we don't use; we have our own `runAgentLoop` |

**Installation:**
No new dependencies needed. The existing `@anthropic-ai/sdk` provides `messages.countTokens()`.

## Architecture Patterns

### Recommended Project Structure
```
packages/agents/src/framework/
  history-manager.ts          # createHistoryManager factory + compactHistory pure function
  history-manager.test.ts     # Unit tests for all pruning/summarization behaviors
  index.ts                    # Updated barrel export
```

### Pattern 1: Stateless Compaction Function
**What:** The History Manager is a pure function (or factory returning a function) that receives the messages array, history config, and optional context, and returns a new compacted messages array. It does NOT mutate the input.
**When to use:** Called by the ConversationExecutor (Phase 40) or directly by `runAgentLoop()` before each LLM call when token threshold is exceeded.
**Example:**
```typescript
// Source: Architecture design based on Anthropic SDK patterns and OpenCode compaction

interface HistoryConfig {
  pruneThreshold: number;    // Token count to trigger Phase 1 pruning
  protectedMessages: number; // Number of recent messages to never touch
  summaryThreshold: number;  // Token count to trigger Phase 2 summarization
  summaryModel: string;      // Model for summary generation (e.g., "claude-haiku-4-5-20251001")
}

interface CompactionResult {
  messages: Anthropic.MessageParam[];
  phase: "none" | "pruned" | "summarized";
  estimatedTokens: number;
  tokensSaved: number;
}

interface HistoryManagerOptions {
  logger: PinoLogger;
}

interface HistoryManager {
  /**
   * Compact the message history according to the config.
   * Returns new messages array (never mutates input).
   */
  compact(
    messages: Anthropic.MessageParam[],
    config: HistoryConfig,
    options?: {
      /** Artifacts from agent_sessions for Phase 2 grounding */
      artifacts?: Record<string, string>;
      /** Anthropic client for countTokens and summary generation */
      anthropicClient?: Anthropic;
      /** System prompt (needed for accurate token counting) */
      systemPrompt?: string;
      /** Tool definitions (needed for accurate token counting) */
      tools?: Anthropic.Tool[];
    },
  ): Promise<CompactionResult>;
}
```

### Pattern 2: Two-Phase Compaction Pipeline
**What:** Phase 1 (pruning) always runs first. Only if the estimated token count after pruning still exceeds `summaryThreshold` does Phase 2 (summarization) run. This is a pipeline, not a choice.
**When to use:** Always -- this is the core flow.
**Flow:**
```
1. Estimate tokens in messages array (character-based)
2. If < pruneThreshold: return messages unchanged (phase: "none")
3. Phase 1: Prune tool outputs in unprotected messages
   a. Deduplicate same-file reads (keep most recent)
   b. Replace prunable tool results with descriptors
   c. Apply head+tail truncation for file reads
4. Re-estimate tokens after pruning
5. If < summaryThreshold: return pruned messages (phase: "pruned")
6. Phase 2: Summarize oldest unprotected section
   a. Extract summary boundary (everything before protected messages)
   b. Generate summary via LLM call with artifacts injected as ground truth
   c. Replace oldest section with single summary message
   d. Return summarized messages (phase: "summarized")
```

### Pattern 3: Tool Result Replacement with Descriptors
**What:** Old tool results are replaced with short text descriptors that tell the LLM what was there.
**When to use:** Phase 1 pruning for unprotected messages.
**Example descriptor formats:**
```typescript
// File reads (head+tail): keep first ~500 tokens + last ~1500 tokens
// head+tail descriptor (replaces middle):
`[File: ${filePath} — showing first ~500 tokens and last ~1500 tokens of ${totalTokens} total. ${removedTokens} tokens removed.]`

// Search/list results (minimal descriptor):
`[Tool: ${toolName} — args: ${JSON.stringify(args)}. ${removedTokens} tokens removed.]`

// Command output (minimal descriptor):
`[Tool: ${toolName} — command: ${command}, exit code: ${exitCode}. ${removedTokens} tokens removed.]`

// Integration results (head+tail, same as file reads):
`[Tool: ${toolName} — showing first ~500 tokens and last ~1500 tokens of ${totalTokens} total. ${removedTokens} tokens removed.]`
```

### Pattern 4: Protected Message Boundary
**What:** The last N messages (from config `protectedMessages`) are never pruned. The boundary is determined by counting from the end of the messages array.
**When to use:** Always during Phase 1.
**Boundary handling:**
```typescript
// Messages array structure:
// [msg0, msg1, ..., msgK, ..., msgN-1, msgN]
//  ^--- unprotected zone ---^  ^-- protected (last N) --^

const protectedStart = Math.max(0, messages.length - config.protectedMessages);
// Only operate on messages[0..protectedStart-1]
```

**Tool call boundary spanning:** If a tool_use block in an assistant message at position P is paired with a tool_result in a user message at position P+1, and one is protected while the other is not, we must not prune the tool_result without also handling the tool_use. The safest approach: extend the protected boundary backward to include the full tool-use/result pair. In practice, since messages are user/assistant alternating and tool_result always follows tool_use, protecting the last N messages automatically protects full pairs as long as N is even (or N >= 2).

### Pattern 5: Summary with Artifact Grounding
**What:** Phase 2 summary includes a machine-readable structured data section injected from `agent_sessions.artifacts`, clearly marked as ground truth.
**When to use:** Phase 2 summarization.
**Example summary prompt:**
```typescript
const summaryPrompt = `Summarize the conversation history so far to allow efficient continuation.

## Instructions
- Focus on what was accomplished, what decisions were made, and what remains
- Preserve all file paths, branch names, PR URLs, and other identifiers
- Include any errors encountered and how they were resolved
- Note any constraints or user preferences discovered

## Ground-Truth Artifacts (from event log -- DO NOT paraphrase or modify)
${formatArtifacts(artifacts)}

## Important
- The artifacts section above is machine-extracted from actual tool results
- Include it verbatim in your summary as a reference section
- Wrap your summary in <summary></summary> tags`;
```

### Anti-Patterns to Avoid
- **Mutating the messages array in place:** Always return a new array. The caller (runAgentLoop) may need the original for persistence.
- **Pruning assistant reasoning text:** Only tool result content blocks should be pruned/replaced. The assistant's text reasoning (TextBlock) must be preserved in full -- it contains the agent's understanding of what was learned from tools.
- **Summarizing summaries repeatedly:** Each Phase 2 invocation should detect if the oldest messages already contain a summary (check for `<summary>` tags or a summary marker) and merge rather than nest.
- **Using the API countTokens on every iteration:** This adds ~100-200ms latency per call. Use character estimation for threshold checks; reserve API counting for summary validation only.
- **Hardcoding tool names in the pruner:** Use the tool-type tier system with pattern matching, not a hardcoded list. The tool names come from tool definitions and may change.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Token counting | Custom tokenizer | `client.messages.countTokens()` for exact counts, `chars / 4` for estimates | Anthropic's tokenizer is proprietary; approximations work for thresholds |
| LLM summarization | Complex multi-step pipeline | Single Anthropic API call with structured prompt | The model is good at summarization; the prompt engineering matters more than the pipeline |
| JSON deep path extraction | Custom path resolver | `getNestedValue()` from session-projection.ts | Already exists in the framework, handles edge cases |

**Key insight:** The History Manager is mostly string manipulation and array operations. The only external call is to Anthropic for token counting (optional) and summarization (Phase 2 only). Keep it simple -- the complexity is in the message format handling, not in external dependencies.

## Common Pitfalls

### Pitfall 1: Summarization Drift (MAJOR)
**What goes wrong:** When summaries are summarized again (compaction of compacted history), information degrades exponentially. Each round of summarization loses nuance, and after 2-3 rounds, the agent has lost critical context.
**Why it happens:** LLM summarization is lossy. Summaries of summaries compound the loss.
**How to avoid:**
1. Inject artifact data as machine-readable structured data that the summarizer is instructed NOT to paraphrase
2. Use a single summary block that gets updated/merged, not multiple stacked summaries
3. Phase 1 (pruning) is the primary strategy -- only invoke Phase 2 when absolutely necessary
4. When Phase 2 runs on history that already contains a summary, the new summary should REPLACE the old one (merge), not nest inside it
**Warning signs:** Agent repeatedly re-reads files it already processed, or asks questions that were already answered earlier in the conversation.

### Pitfall 2: Tool Use / Tool Result Pairing (MAJOR)
**What goes wrong:** Anthropic's API requires that every `tool_use` block in an assistant message has a corresponding `tool_result` block in the following user message (and vice versa). If pruning removes or modifies one without the other, the API returns a validation error.
**Why it happens:** The messages array has a strict structure: assistant message with tool_use blocks, followed by user message with tool_result blocks. These must remain paired.
**How to avoid:**
1. Always process tool_use and tool_result as a pair (assistant message + following user message)
2. When replacing a tool_result content, keep the `tool_use_id` reference intact
3. When pruning, replace the tool_result content string, never remove the tool_result block entirely
4. The descriptor text replaces the `content` field of the `ToolResultBlockParam`, but the `tool_use_id` and `type` fields remain unchanged
**Warning signs:** 400 errors from Anthropic API about missing tool results or tool use IDs.

### Pitfall 3: Character Estimation Accuracy
**What goes wrong:** The 1 token ~= 4 characters heuristic can be off by 20-30% for certain content types (code with many symbols, JSON with lots of structural characters, non-English text).
**Why it happens:** Claude's tokenizer is BPE-based and handles different content types with different efficiency.
**How to avoid:**
1. Set pruneThreshold conservatively -- trigger earlier rather than later (community consensus: 65-75% of context capacity)
2. Use the exact `countTokens()` API for Phase 2 summary validation (but not on the hot path)
3. Consider the threshold as "approximate trigger point" not "exact limit"
**Warning signs:** Phase 1 pruning consistently not reducing tokens enough because estimates were too optimistic.

### Pitfall 4: Protected Boundary at Odd Position
**What goes wrong:** If the protected boundary falls in the middle of a tool_use/tool_result pair, you get an invalid message array.
**Why it happens:** Tool interactions span two messages (assistant with tool_use, user with tool_result). Cutting between them corrupts the conversation.
**How to avoid:**
1. After computing `protectedStart`, check if the message at that position is a user message containing only `tool_result` blocks
2. If so, move `protectedStart` back by 1 to include the preceding assistant message with the matching `tool_use` blocks
3. This ensures all protected messages form complete conversational pairs
**Warning signs:** API validation errors specifically about mismatched tool_use_id values.

### Pitfall 5: System Prompt Not Counted in Threshold
**What goes wrong:** The history config thresholds (pruneThreshold, summaryThreshold) are compared against message tokens, but the actual context window also includes the system prompt and tool definitions. If these are large (easily 5,000-10,000 tokens), the effective budget for messages is smaller.
**Why it happens:** Threshold comparison only counts messages, not the full request.
**How to avoid:**
1. When estimating tokens for threshold comparison, add a fixed overhead estimate for system prompt + tool definitions (or ideally, pass these in so they can be estimated too)
2. Alternatively, set thresholds in the YAML definition to already account for system prompt overhead (the current definitions appear to do this -- dev-agent pruneThreshold of 80K vs 200K context window)
**Warning signs:** Context window exceeded errors despite pruning.

## Code Examples

Verified patterns from official sources and codebase analysis:

### Token Estimation (Character-Based)
```typescript
// Source: Community consensus, Anthropic docs recommendation for approximation
// 1 token ~= 4 characters for English text

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function estimateMessageTokens(messages: Anthropic.MessageParam[]): number {
  let total = 0;
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      total += estimateTokens(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === "text") {
          total += estimateTokens(block.text);
        } else if (block.type === "tool_use") {
          total += estimateTokens(JSON.stringify(block.input));
          total += estimateTokens(block.name);
        } else if (block.type === "tool_result") {
          if (typeof block.content === "string") {
            total += estimateTokens(block.content);
          } else if (Array.isArray(block.content)) {
            for (const inner of block.content) {
              if (inner.type === "text") {
                total += estimateTokens(inner.text);
              }
            }
          }
        }
      }
    }
    // Per-message overhead (role, structural tokens)
    total += 4;
  }
  return total;
}
```

### Exact Token Counting via API
```typescript
// Source: Anthropic API docs - https://platform.claude.com/docs/en/api/messages-count-tokens
// Free API endpoint, subject to rate limits

async function countExactTokens(
  client: Anthropic,
  messages: Anthropic.MessageParam[],
  model: string,
  system?: string,
  tools?: Anthropic.Tool[],
): Promise<number> {
  const params: Anthropic.MessageCountTokensParams = {
    model,
    messages,
  };
  if (system) {
    params.system = system;
  }
  if (tools && tools.length > 0) {
    params.tools = tools;
  }
  const result = await client.messages.countTokens(params);
  return result.input_tokens;
}
```

### Tool Result Identification in Messages
```typescript
// Source: Codebase analysis of runAgentLoop.ts message structure

/**
 * Anthropic messages have this structure in our agent loop:
 *
 * messages[0]: { role: "user", content: "initial task message" }
 * messages[1]: { role: "assistant", content: [TextBlock, ToolUseBlock, ...] }
 * messages[2]: { role: "user", content: [ToolResultBlockParam, ...] }
 * messages[3]: { role: "assistant", content: [TextBlock, ToolUseBlock, ...] }
 * messages[4]: { role: "user", content: [ToolResultBlockParam, ...] }
 * ... and so on
 */

function isToolResultMessage(msg: Anthropic.MessageParam): boolean {
  if (msg.role !== "user" || typeof msg.content === "string") return false;
  return Array.isArray(msg.content) &&
    msg.content.length > 0 &&
    msg.content.every(
      (block) => block.type === "tool_result"
    );
}

function getToolNameFromAssistantMessage(
  msg: Anthropic.MessageParam,
  toolUseId: string,
): string | undefined {
  if (msg.role !== "assistant" || typeof msg.content === "string") return undefined;
  const block = (msg.content as Anthropic.ContentBlock[]).find(
    (b) => b.type === "tool_use" && b.id === toolUseId,
  );
  return block?.type === "tool_use" ? block.name : undefined;
}
```

### Head+Tail Truncation
```typescript
// Source: OpenCode pattern, adapted for token-based boundaries

function headTailTruncate(
  text: string,
  headTokens: number,
  tailTokens: number,
): { truncated: string; removedTokens: number } {
  const totalTokens = estimateTokens(text);
  const maxTokens = headTokens + tailTokens;

  if (totalTokens <= maxTokens) {
    return { truncated: text, removedTokens: 0 };
  }

  // Convert token targets to character positions (approximate)
  const headChars = headTokens * 4;
  const tailChars = tailTokens * 4;

  const head = text.slice(0, headChars);
  const tail = text.slice(-tailChars);
  const removedTokens = totalTokens - estimateTokens(head) - estimateTokens(tail);

  const truncated = `${head}\n\n[... ${removedTokens} tokens truncated ...]\n\n${tail}`;
  return { truncated, removedTokens };
}
```

### Deduplication by File Path
```typescript
// Source: CONTEXT.md decision - dedup by file path, keep most recent

function deduplicateFileReads(
  messages: Anthropic.MessageParam[],
  protectedStart: number,
): Anthropic.MessageParam[] {
  // Track file paths seen so far (from end to start)
  // Key: file path, Value: message index of most recent read
  const seenFiles = new Map<string, number>();

  // Scan from end to start to find most recent reads
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (i >= protectedStart) continue; // Skip protected
    if (msg.role !== "user" || typeof msg.content === "string") continue;

    for (const block of msg.content) {
      if (block.type !== "tool_result") continue;
      // Look up the tool name from the preceding assistant message
      const toolName = getToolNameFromPrecedingAssistant(messages, i, block.tool_use_id);
      if (toolName !== "read_file" && toolName !== "get_file_contents") continue;

      const filePath = getFilePathFromToolUse(messages, i, block.tool_use_id);
      if (!filePath) continue;

      if (!seenFiles.has(filePath)) {
        seenFiles.set(filePath, i);
      }
      // Earlier reads of same file will be replaced with descriptors
    }
  }

  // Now replace earlier reads with descriptors
  // (implementation replaces tool_result content for non-most-recent reads)
  // ...
}
```

### Phase 2 Summary with Artifact Grounding
```typescript
// Source: CONTEXT.md decision - passive grounding from session projection

function formatArtifacts(artifacts: Record<string, string>): string {
  if (Object.keys(artifacts).length === 0) {
    return "(no artifacts recorded yet)";
  }
  return Object.entries(artifacts)
    .map(([key, value]) => `- **${key}**: ${value}`)
    .join("\n");
}

async function generateSummary(
  client: Anthropic,
  messagesToSummarize: Anthropic.MessageParam[],
  artifacts: Record<string, string>,
  summaryModel: string,
): Promise<string> {
  // Build the summary request as a conversation
  const summaryMessages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `You are summarizing a conversation to allow efficient continuation.

## Conversation to Summarize
${serializeMessagesForSummary(messagesToSummarize)}

## Ground-Truth Artifacts (from event log -- DO NOT paraphrase or modify)
${formatArtifacts(artifacts)}

## Instructions
Create a structured continuation summary including:
1. **Task Overview**: The user's core request and constraints
2. **Completed Work**: What has been accomplished, files modified, key outputs
3. **Key Decisions**: Technical decisions, rationale, errors resolved
4. **Current State**: Where the agent stopped, what was in progress
5. **Next Steps**: Specific actions needed to continue

## Artifacts (from event log)
Include the Ground-Truth Artifacts section verbatim -- these are machine-extracted from actual tool results and must not be paraphrased.

Wrap your summary in <summary></summary> tags.`,
    },
  ];

  const response = await client.messages.create({
    model: summaryModel,
    max_tokens: 4096,
    messages: summaryMessages,
  });

  // Extract summary from <summary> tags
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const match = text.match(/<summary>([\s\S]*?)<\/summary>/);
  return match ? match[1].trim() : text;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Client-side summarization only | Anthropic server-side `context_management.edits.clear_tool_uses` | June 2025 (beta) | Server-side tool clearing available but limited; client-side still needed for advanced strategies |
| SDK `compaction_control` on `tool_runner` | Same but with configurable model/prompt | Late 2025 | SDK handles compaction automatically if using tool_runner, but we use custom runAgentLoop |
| Observation masking via simple truncation | Evidence-based: masking matches summarization quality (JetBrains NeurIPS 2025) | Dec 2025 | Validates that Phase 1 pruning alone is often sufficient |
| Compact at 90%+ of context | Compact at 65-75% of context capacity | 2025 community consensus | Earlier compaction preserves more working memory; compacting under pressure produces worse summaries |

**Deprecated/outdated:**
- `@anthropic-ai/tokenizer`: Beta, not accurate for Claude 3+ models. Use `client.messages.countTokens()` instead.
- `context-counting-2024-11-01` beta header: Token counting API is now stable, no beta header needed.

## Open Questions

Things that couldn't be fully resolved:

1. **Optimal pruneThreshold values per agent type**
   - What we know: Dev-agent uses 80K, researcher uses 40K. Community consensus is 65-75% of context window.
   - What's unclear: Whether these specific values are optimal for Aesir's workload. They were set in Phase 38 based on the research from the CONTEXT.md.
   - Recommendation: Use the Phase 38 values as-is. They can be tuned empirically after integration testing in Phase 40+.

2. **Summary size target**
   - What we know: Claude Code's compaction reduces ~100K tokens to ~2-3K tokens. OpenCode's summaries are similarly compact.
   - What's unclear: What the ideal summary size is for our use case where artifact grounding adds structured data.
   - Recommendation: Let the summary model decide the length (up to max_tokens: 4096). The artifact section adds fixed overhead but is small (typically <500 tokens).

3. **Phase 1 -> Phase 2 transition: should we re-estimate or use exact counting?**
   - What we know: Character estimation can be 20-30% off. After Phase 1 pruning, we need to decide if Phase 2 is needed.
   - What's unclear: Whether the estimation error matters at the transition boundary.
   - Recommendation: Use character estimation for the transition check too. If it says we're still above summaryThreshold after pruning, that's a strong signal. The worst case (false positive) is an unnecessary but harmless Phase 2 summary. The alternative (false negative where we don't summarize when we should) is handled by the next iteration's threshold check. Optionally: use `countTokens()` API for the Phase 1->Phase 2 transition since it only happens at most once per compaction cycle (not on every iteration).

4. **What happens when compaction fails to reduce tokens sufficiently?**
   - What we know: This is in Claude's Discretion per CONTEXT.md.
   - What's unclear: Exact failure mode.
   - Recommendation: Log a warning and return the best-effort result. The agent loop's existing token budget system (from `token-budget.ts`) provides a hard stop when tokens are exhausted. The History Manager is an optimization, not a safety mechanism.

## Sources

### Primary (HIGH confidence)
- Anthropic API docs: `messages.countTokens()` endpoint - exact token counting, free, rate-limited
- Anthropic API docs: Context Editing with `clear_tool_uses_20250919` - server-side tool clearing (beta)
- Anthropic API docs: Client-side compaction via SDK `compaction_control` - summary prompt structure, default prompt
- Existing codebase: `runAgentLoop()` in `packages/agents/src/shared/agent-loop/run-agent-loop.ts` - message format is `Anthropic.MessageParam[]`
- Existing codebase: `agent_sessions.artifacts` (Record<string, string>) - ground-truth artifacts from session projection
- Existing codebase: Agent definition YAML history config - `pruneThreshold`, `protectedMessages`, `summaryThreshold`, `summaryModel`

### Secondary (MEDIUM confidence)
- JetBrains NeurIPS 2025 "The Complexity Trap" paper: Observation masking matches summarization at lower cost
- OpenCode context compaction: `packages/opencode/src/session/compaction.ts` - pruning, threshold detection, Token.estimate()
- Claude Code compaction behavior: Auto-compact at ~95% capacity, configurable threshold, `<summary>` tag format
- Community consensus (Claude Code, Cline, OpenCode): Compact at 65-75% capacity, not 90%+

### Tertiary (LOW confidence)
- Character-per-token ratio (1:4): Commonly cited but can vary 20-30% by content type. Sufficient for threshold checks, not for billing.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new dependencies, using existing Anthropic SDK
- Architecture: HIGH - Pattern well-established by Claude Code, OpenCode, Cline; codebase integration points are clear
- Pitfalls: HIGH - Well-documented in community issues (OpenCode #2945, #4102), academic research (JetBrains), and Anthropic docs
- Token counting: MEDIUM - Character estimation ratio is approximate; exact API is verified but adds latency
- Summarization prompt: LOW - Prompt engineering is empirical; the template is based on Anthropic's default compaction prompt but needs validation with actual agent workloads

**Research date:** 2026-02-01
**Valid until:** 2026-03-01 (stable domain, but Anthropic context_management beta may graduate)

# Future Improvements

Proposals identified during development and testing. Revisit as needed.

---

## 1. Graceful handling of thread replies to completed conversations

**Problem:** When a product-agent conversation completes (due to bugs or normal end-of-flow) and the user replies in the same Slack thread, the router finds the conversation completed, cannot signal it, and silently drops the message. The user gets no response and no guidance.

**Context:** Discovered during v2.3 E2E validation. The product agent was missing `wait_for`, so it completed after asking a question. The user's reply was silently dropped by the router.

**Options:**

| Option | Description | Tradeoffs |
|--------|-------------|-----------|
| Conversation reopen | Allow `signal()` to transition `completed` -> `queued` for `user_reply` signals, with a time window guard (e.g., 1 hour) | Preserves full message history. Needs guardrails to prevent stale conversations from being revived accidentally. Cleanest UX -- user doesn't notice anything changed. |
| Router auto-restart | Router detects completed conversation for a thread reply and starts a new conversation with thread context injected | User doesn't need to know internals. Loses original conversation history unless explicitly carried over. More complex routing logic. |
| User feedback fallback | System-level (not LLM) message sent to the thread: "This conversation has ended. @mention me to start a new one." | Minimal change. Doesn't solve the problem, just makes it visible. Better than silence. Could be a quick win alongside a deeper fix. |

**Recommendation:** Option 1 (conversation reopen) with a time-window guard. Smallest change, preserves history, matches user mental model.

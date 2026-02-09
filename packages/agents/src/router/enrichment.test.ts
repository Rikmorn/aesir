import { describe, expect, it } from "vitest";
import type { IncomingEvent } from "../adapters/types.js";
import { type EnrichmentDeps, enrichInitialMessage } from "./enrichment.js";

/**
 * Helper to create a minimal IncomingEvent for tests.
 */
function makeEvent(overrides: Partial<IncomingEvent> = {}): IncomingEvent {
  return {
    type: "test.event",
    source: "test",
    data: {},
    message: "test message",
    ...overrides,
  };
}

describe("enrichInitialMessage", () => {
  // ─── Workspace Context ──────────────────────────────────────────────────

  it("should inject workspace_context when GitHub/Linear config present", () => {
    const deps: EnrichmentDeps = {
      githubOwner: "my-org",
      githubRepo: "my-repo",
      githubBaseBranch: "main",
      linearTeamId: "TEAM-123",
    };

    const result = enrichInitialMessage(makeEvent(), deps);

    expect(result).toContain("<workspace_context>");
    expect(result).toContain("GitHub Owner: my-org");
    expect(result).toContain("GitHub Repo: my-repo");
    expect(result).toContain("GitHub Base Branch: main");
    expect(result).toContain("Linear Team ID: TEAM-123");
    expect(result).toContain("</workspace_context>");
    expect(result).toContain("test message");
  });

  it("should skip workspace_context when no config provided", () => {
    const result = enrichInitialMessage(makeEvent(), {});

    expect(result).not.toContain("<workspace_context>");
    expect(result).toBe("test message");
  });

  // ─── Default Notify Target ──────────────────────────────────────────────

  it("should inject default_notify_target when slackTeamId and matching notifyChannels entry", () => {
    const deps: EnrichmentDeps = {
      slackTeamId: "T01234567",
      notifyChannels: {
        "dev-agent": "C99887766",
      },
    };

    const result = enrichInitialMessage(
      makeEvent(),
      deps,
      undefined,
      "dev-agent",
    );

    expect(result).toContain("<default_notify_target>");
    expect(result).toContain("</default_notify_target>");

    // Extract the JSON between the tags
    const match = result.match(
      /<default_notify_target>\n(.*)\n<\/default_notify_target>/,
    );
    expect(match).not.toBeNull();
    expect(match![1]).toBeDefined();
    const target = JSON.parse(match![1] as string);
    expect(target).toEqual({
      channel: "slack",
      teamId: "T01234567",
      channelId: "C99887766",
    });
  });

  it("should NOT inject default_notify_target when slackTeamId is missing", () => {
    const deps: EnrichmentDeps = {
      notifyChannels: {
        "dev-agent": "C99887766",
      },
    };

    const result = enrichInitialMessage(
      makeEvent(),
      deps,
      undefined,
      "dev-agent",
    );

    expect(result).not.toContain("<default_notify_target>");
  });

  it("should NOT inject default_notify_target when agentDefinitionId not in notifyChannels", () => {
    const deps: EnrichmentDeps = {
      slackTeamId: "T01234567",
      notifyChannels: {
        "dev-agent": "C99887766",
      },
    };

    const result = enrichInitialMessage(
      makeEvent(),
      deps,
      undefined,
      "unknown-agent",
    );

    expect(result).not.toContain("<default_notify_target>");
  });

  it("should NOT inject default_notify_target when agentDefinitionId is not provided", () => {
    const deps: EnrichmentDeps = {
      slackTeamId: "T01234567",
      notifyChannels: {
        "dev-agent": "C99887766",
      },
    };

    const result = enrichInitialMessage(makeEvent(), deps);

    expect(result).not.toContain("<default_notify_target>");
  });

  it("should NOT inject default_notify_target when notifyChannels is empty", () => {
    const deps: EnrichmentDeps = {
      slackTeamId: "T01234567",
      notifyChannels: {},
    };

    const result = enrichInitialMessage(
      makeEvent(),
      deps,
      undefined,
      "dev-agent",
    );

    expect(result).not.toContain("<default_notify_target>");
  });

  // ─── Slack Context Removal ──────────────────────────────────────────────

  it("should NOT inject slack_context for Slack-originated events", () => {
    const event = makeEvent({
      source: "slack:webhook",
      data: { channelId: "C12345", threadTs: "1234.5678" },
    });

    const result = enrichInitialMessage(event, {});

    expect(result).not.toContain("<slack_context>");
    expect(result).not.toContain("</slack_context>");
  });

  // ─── Combined Blocks ───────────────────────────────────────────────────

  it("should inject both workspace_context and default_notify_target", () => {
    const deps: EnrichmentDeps = {
      githubOwner: "my-org",
      githubRepo: "my-repo",
      linearTeamId: "TEAM-123",
      slackTeamId: "T01234567",
      notifyChannels: {
        "product-agent": "C55544433",
      },
    };

    const result = enrichInitialMessage(
      makeEvent(),
      deps,
      undefined,
      "product-agent",
    );

    expect(result).toContain("<workspace_context>");
    expect(result).toContain("<default_notify_target>");
    // workspace_context is prepended first, then notify_target is prepended after,
    // so notify_target appears before workspace_context in the final string
    const notifyIdx = result.indexOf("<default_notify_target>");
    const workspaceIdx = result.indexOf("<workspace_context>");
    expect(notifyIdx).toBeLessThan(workspaceIdx);
  });

  // ─── Message Fallback ──────────────────────────────────────────────────

  it("should use provided message over event.message", () => {
    const result = enrichInitialMessage(makeEvent(), {}, "custom message");

    expect(result).toBe("custom message");
    expect(result).not.toContain("test message");
  });

  it("should fall back to JSON.stringify(event.data) when no message", () => {
    const event = makeEvent({
      message: undefined,
      data: { key: "value" },
    });

    const result = enrichInitialMessage(event, {});

    expect(result).toBe('{"key":"value"}');
  });
});

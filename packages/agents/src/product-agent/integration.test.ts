/**
 * Product Agent Integration Tests
 *
 * Tests the complete flow from Slack event to Linear issue creation.
 * Requires running infrastructure (Docker Compose).
 *
 * Run with: TEST_MODE=integration pnpm --filter @aesir/agents test
 */

import { beforeAll, describe, expect, it } from "vitest";

/** Response shape for health endpoint */
interface HealthResponse {
  status: string;
  service: string;
}

/** Response shape for events endpoint */
interface EventsResponse {
  received: boolean;
  eventId?: string;
  type?: string;
  ignored?: boolean;
  reason?: string;
  error?: string;
}

// These tests require Docker Compose infrastructure
// Skip if not in integration test mode
const isIntegrationTest = process.env.TEST_MODE === "integration";

describe.skipIf(!isIntegrationTest)("Product Agent E2E", () => {
  beforeAll(async () => {
    // Verify infrastructure is running
    const healthChecks = await Promise.all([
      fetch("http://localhost:3005/health").catch(() => null),
      fetch("http://localhost:3001/health").catch(() => null),
      fetch("http://localhost:3003/health").catch(() => null),
    ]);

    const [productAgent, linear, slack] = healthChecks;

    if (!productAgent?.ok) {
      throw new Error(
        "Product-agent not running on port 3005. Start with: docker compose up",
      );
    }
    if (!linear?.ok) {
      throw new Error(
        "Linear integration not running on port 3001. Start with: docker compose up",
      );
    }
    if (!slack?.ok) {
      throw new Error(
        "Slack integration not running on port 3003. Start with: docker compose up",
      );
    }
  });

  describe("Health Checks", () => {
    it("product-agent responds on port 3005", async () => {
      const response = await fetch("http://localhost:3005/health");
      expect(response.ok).toBe(true);

      const body = (await response.json()) as HealthResponse;
      expect(body.status).toBe("ok");
      expect(body.service).toBe("product-agent");
    });
  });

  describe("Event Handling", () => {
    it("accepts normalized Slack events", async () => {
      const event = {
        id: "evt_test_123",
        type: "slack.app_mention.created",
        source: "slack",
        timestamp: new Date().toISOString(),
        correlationId: "test_corr_123",
        payload: {
          channel: "C12345", // Not in allowlist - should be ignored
          user: "U12345",
          text: "Add a feature to export data",
          ts: "1234567890.123456",
        },
      };

      const response = await fetch("http://localhost:3005/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Correlation-ID": event.correlationId,
          "X-Event-ID": event.id,
        },
        body: JSON.stringify(event),
      });

      expect(response.ok).toBe(true);

      const body = (await response.json()) as EventsResponse;
      expect(body.received).toBe(true);
      // Event received but channel not in allowlist - processed but no workflow started
      // Response includes eventId and type
      expect(body.eventId).toBe(event.id);
      expect(body.type).toBe(event.type);
    });

    it("rejects invalid event payloads", async () => {
      const response = await fetch("http://localhost:3005/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invalid: "payload" }),
      });

      expect(response.status).toBe(400);

      const body = (await response.json()) as EventsResponse;
      expect(body.error).toBe("Invalid event payload");
    });

    it("rejects malformed JSON", async () => {
      const response = await fetch("http://localhost:3005/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not valid json",
      });

      expect(response.status).toBe(400);

      const body = (await response.json()) as EventsResponse;
      expect(body.error).toBe("Invalid JSON");
    });

    it("ignores non-Slack events", async () => {
      const event = {
        id: "evt_github_123",
        type: "github.pull_request.opened",
        source: "github",
        timestamp: new Date().toISOString(),
        correlationId: "test_corr_456",
        payload: {
          number: 123,
          title: "Test PR",
        },
      };

      const response = await fetch("http://localhost:3005/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Correlation-ID": event.correlationId,
          "X-Event-ID": event.id,
        },
        body: JSON.stringify(event),
      });

      expect(response.ok).toBe(true);

      const body = (await response.json()) as EventsResponse;
      expect(body.received).toBe(true);
      expect(body.ignored).toBe(true);
      expect(body.reason).toBe("Not a Slack event");
    });
  });

  // Full E2E test requires:
  // 1. Valid Slack credentials
  // 2. Valid Linear credentials
  // 3. Temporal running
  // 4. Product-agent in allowed channel
  //
  // This is verified manually with human checkpoint - see E2E-VERIFICATION.md
  describe.skip("Full Flow (Manual Verification)", () => {
    it("creates Linear issue from Slack conversation", async () => {
      // This test would:
      // 1. Post to Slack channel (mock or real)
      // 2. Verify product-agent responds with question
      // 3. Reply with more details
      // 4. Verify confirmation prompt
      // 5. Send confirmation
      // 6. Verify Linear issue created with correct content
      //
      // Marked skip - use human checkpoint for real verification
      // See: E2E-VERIFICATION.md for manual verification steps
    });
  });
});

#!/usr/bin/env bun
/**
 * Aesir v2.7 Triangular Workflow Validation
 *
 * Triggers the full product-agent -> dev-agent -> QA-agent delegation workflow
 * by posting a synthetic slack.app_mention.created event to the agent service.
 *
 * Optionally polls the task tree API to show delegation progress.
 *
 * Run with: pnpm --filter @aesir/agents validate:workflow
 * With polling: pnpm --filter @aesir/agents validate:workflow -- --poll
 */

import { loadEnvFromRoot } from "@aesir/platform";

loadEnvFromRoot();

import { nanoid } from "nanoid";

// ─── Constants ──────────────────────────────────────────────────────────────

const AGENT_SERVICE_URL =
  process.env.AGENT_SERVICE_URL || "http://localhost:3004";
const DASHBOARD_URL =
  process.env.DASHBOARD_URL || "http://localhost:3005/dashboard";

// ─── Health Check ───────────────────────────────────────────────────────────

async function waitForHealth(url: string, maxWaitMs = 30_000): Promise<void> {
  const start = Date.now();
  const pollIntervalMs = 1_000;

  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) {
        return;
      }
    } catch {
      // Service not up yet — retry
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(
    `Agent service at ${url} did not become healthy within ${maxWaitMs / 1_000}s. ` +
      `Ensure it is running: docker compose up agent-service`,
  );
}

// ─── Task Tree Polling ──────────────────────────────────────────────────────

interface TaskTreeNode {
  id: string;
  status: string;
  title?: string;
}

async function pollTaskTree(
  rootTaskId: string,
  maxDurationMs = 300_000,
): Promise<void> {
  const start = Date.now();
  const pollIntervalMs = 10_000;

  console.log(`\nPolling task tree (root: ${rootTaskId})...`);
  console.log("Press Ctrl+C to stop polling.\n");

  const terminalStatuses = new Set(["completed", "failed", "cancelled"]);

  while (Date.now() - start < maxDurationMs) {
    try {
      const res = await fetch(
        `${AGENT_SERVICE_URL}/api/tasks/tree?rootTaskId=${rootTaskId}`,
      );

      if (res.ok) {
        const data = (await res.json()) as { nodes?: TaskTreeNode[] };
        const nodes = data.nodes || [];
        const statusCounts: Record<string, number> = {};

        for (const node of nodes) {
          statusCounts[node.status] = (statusCounts[node.status] || 0) + 1;
        }

        const summary = Object.entries(statusCounts)
          .map(([status, count]) => `${status}=${count}`)
          .join(", ");

        const elapsed = Math.round((Date.now() - start) / 1_000);
        console.log(`[${elapsed}s] Tasks: ${nodes.length} (${summary})`);

        // Check if root task reached terminal state
        const rootNode = nodes.find((n) => n.id === rootTaskId);
        if (rootNode && terminalStatuses.has(rootNode.status)) {
          console.log(`\nRoot task reached terminal state: ${rootNode.status}`);
          return;
        }
      } else {
        const elapsed = Math.round((Date.now() - start) / 1_000);
        console.log(`[${elapsed}s] Task tree API returned ${res.status}`);
      }
    } catch (error) {
      const elapsed = Math.round((Date.now() - start) / 1_000);
      console.log(`[${elapsed}s] Poll failed: ${(error as Error).message}`);
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  console.log("\nPolling timed out after 5 minutes.");
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(60));
  console.log("  Aesir v2.7 Triangular Workflow Validation");
  console.log("=".repeat(60));
  console.log();

  // 1. Wait for service health
  console.log(`Waiting for agent-service at ${AGENT_SERVICE_URL}...`);
  await waitForHealth(AGENT_SERVICE_URL);
  console.log("Agent service is healthy.\n");

  // 2. Construct synthetic event
  const correlationId = `validate_${nanoid()}`;
  const event = {
    id: `evt_${nanoid()}`,
    type: "slack.app_mention.created",
    source: "slack" as const,
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

  console.log("Posting synthetic event:");
  console.log(`  ID:            ${event.id}`);
  console.log(`  Type:          ${event.type}`);
  console.log(`  CorrelationID: ${correlationId}`);
  console.log();

  // 3. Post to /events
  const response = await fetch(`${AGENT_SERVICE_URL}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });

  const responseBody = await response.json();
  console.log(`Response: ${response.status} ${response.statusText}`);
  console.log(JSON.stringify(responseBody, null, 2));
  console.log();

  // 4. Extract conversation/task info and print dashboard URL
  const conversationId =
    (responseBody as Record<string, unknown>).conversationId ||
    (responseBody as Record<string, unknown>).id;
  const taskId = (responseBody as Record<string, unknown>).taskId;

  if (conversationId) {
    console.log(
      `Dashboard (conversation): ${DASHBOARD_URL}/conversations/${conversationId}`,
    );
  }
  if (taskId) {
    console.log(`Dashboard (task tree): ${DASHBOARD_URL}/tasks/${taskId}`);
  }
  console.log(`Dashboard (events): ${DASHBOARD_URL}/events`);
  console.log();

  // 5. Optional polling
  const shouldPoll = process.argv.includes("--poll");
  if (shouldPoll && taskId) {
    await pollTaskTree(taskId as string);
  } else if (shouldPoll && !taskId) {
    console.log(
      "Note: --poll requested but no taskId in response. Skipping polling.",
    );
  }

  // 6. Print manual verification checklist
  console.log("─".repeat(60));
  console.log("  Manual Verification Checklist");
  console.log("─".repeat(60));
  console.log();
  console.log("Open the dashboard to verify:");
  console.log(
    "1. [ ] Task tree shows full triangle (product->dev->QA, plus fix subtree if triggered)",
  );
  console.log(
    "2. [ ] Handshakes visible — accept + estimate on each delegation",
  );
  console.log(
    "3. [ ] Signals flow chronologically — delegation created, accepted, completed",
  );
  console.log(
    "4. [ ] Health indicators green (no orphans, no unresolved timeouts)",
  );
  console.log(
    "5. [ ] Knowledge entries exist: SELECT * FROM agents.knowledge_entries WHERE type = 'test_result'",
  );
  console.log("6. [ ] Conversation links show coherent message history");
  console.log();

  // 7. Print prerequisites
  console.log("─".repeat(60));
  console.log("  Prerequisites");
  console.log("─".repeat(60));
  console.log();
  console.log(
    "- docker compose up postgresql github-integration agent-service",
  );
  console.log("- pnpm db:migrate");
  console.log("- pnpm --filter @aesir/agents seed:directory");
  console.log("- Embedding service running (for directory:find)");
  console.log();
}

main().catch((error) => {
  console.error("Validation failed:", error);
  process.exit(1);
});

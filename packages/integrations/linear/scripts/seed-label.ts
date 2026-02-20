#!/usr/bin/env tsx
/**
 * Seed agent-work Label in Linear
 *
 * Creates the "agent-work" label in the configured Linear team.
 * Used by the materialization system to tag issues created by agents.
 * Idempotent: skips if the label already exists.
 *
 * Run with: pnpm --filter @aesir/integration-linear seed:labels
 */

import { loadEnvFromRoot } from "@aesir/platform";

loadEnvFromRoot();

import { LinearClient } from "@linear/sdk";

const LABEL_NAME = "agent-work";
const LABEL_COLOR = "#6B7280"; // Gray, neutral

async function main() {
  const accessToken = process.env.LINEAR_ACCESS_TOKEN;
  if (!accessToken) {
    console.error("LINEAR_ACCESS_TOKEN is not set. Add it to your .env file.");
    process.exit(1);
  }

  const teamId = process.env.LINEAR_TEAM_ID;
  if (!teamId) {
    console.error("LINEAR_TEAM_ID is not set. Add it to your .env file.");
    process.exit(1);
  }

  const client = new LinearClient({ apiKey: accessToken });

  console.log(`Checking for "${LABEL_NAME}" label in team ${teamId}...`);

  // Get the team to access its labels
  const team = await client.team(teamId);
  const labels = await team.labels();

  // Check if label already exists
  const existing = labels.nodes.find(
    (l) => l.name.toLowerCase() === LABEL_NAME.toLowerCase(),
  );

  if (existing) {
    console.log(
      `  Label "${LABEL_NAME}" already exists (id: ${existing.id}). Skipping.`,
    );
  } else {
    // Create the label (team-level)
    const result = await client.createIssueLabel({
      name: LABEL_NAME,
      color: LABEL_COLOR,
      teamId,
    });

    const label = await result.issueLabel;
    if (label) {
      console.log(
        `  Created label "${LABEL_NAME}" (id: ${label.id}, color: ${LABEL_COLOR})`,
      );
    } else {
      console.error("  Failed to create label (no label returned)");
      process.exit(1);
    }
  }

  console.log("Done.");
}

main().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});

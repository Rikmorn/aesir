#!/usr/bin/env tsx
/**
 * Seed Entity Directory from Agent Definitions
 *
 * Reads YAML agent definitions, generates capability embeddings via
 * the configured embedding provider, and upserts into the entity_directory table.
 *
 * Idempotent: re-running updates existing entries without duplicating.
 * Skips embedding regeneration when capabilities haven't changed.
 * Marks agents removed from YAML as status='inactive' (scoped to type='agent').
 *
 * Run with: pnpm --filter @aesir/agents seed:directory
 */

import { loadEnvFromRoot } from "@aesir/platform";

loadEnvFromRoot();

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPinoLogger } from "@aesir/platform";
import { and, eq, notInArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { createAgentRegistry } from "../src/framework/agent-registry.js";
import { entityDirectory } from "../src/shared/db/schema.js";
import type { EmbeddingConfig } from "../src/shared/embedding/index.js";
import { createEmbeddingService } from "../src/shared/embedding/index.js";

const logger = createPinoLogger({ component: "seed-directory" });

// ─── Embedding Config ────────────────────────────────────────────────────────

const embeddingConfig: EmbeddingConfig = {
  provider: (process.env.EMBEDDING_PROVIDER || "ollama") as "ollama" | "voyage",
  dimensions: Number(process.env.EMBEDDING_DIMENSIONS || "768"),
  ollama: {
    url: process.env.OLLAMA_URL || "http://localhost:11434",
    model: process.env.OLLAMA_MODEL || "nomic-embed-text",
  },
  voyage: {
    apiKey: process.env.VOYAGE_API_KEY as string | undefined,
    model: process.env.VOYAGE_MODEL || "voyage-3",
  },
};

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const connectionString =
    process.env.DATABASE_URL ||
    `postgres://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`;

  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client);

  const embeddingService = createEmbeddingService({
    config: embeddingConfig,
    logger,
  });

  // Resolve definitions directory relative to script location
  const DEFINITIONS_DIR = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../definitions",
  );

  const registry = createAgentRegistry({
    definitionsDir: DEFINITIONS_DIR,
    logger,
  });

  console.log("Seeding entity directory from agent definitions...\n");

  // Load all definitions and filter to those with capabilities
  const definitions = await registry.list();
  const withCaps = definitions.filter(
    (d) => d.capabilities && d.capabilities.length > 0,
  );

  if (withCaps.length === 0) {
    console.log("No agents with capabilities found. Nothing to seed.");
    await client.end();
    return;
  }

  // Helper: sorted capabilities comparison
  const sortedCaps = (caps: string[]) => [...caps].sort();

  const seededIds: string[] = [];

  for (const def of withCaps) {
    // At this point, capabilities is guaranteed to be a non-empty array
    // by the filter above, so we extract it once for safe access.
    const capabilities = def.capabilities as string[];

    // Check existing entry
    const existing = await db
      .select({ capabilities: entityDirectory.capabilities })
      .from(entityDirectory)
      .where(eq(entityDirectory.id, def.id))
      .then((rows) => rows[0] ?? null);

    // Determine if capabilities changed
    const capsChanged =
      !existing ||
      JSON.stringify(sortedCaps(existing.capabilities as string[])) !==
        JSON.stringify(sortedCaps(capabilities));

    // Generate embedding only if capabilities changed
    let embedding: number[] | undefined;
    if (capsChanged) {
      const capsText = capabilities.join(". ");
      const result = await embeddingService.embed(capsText);
      if (!result) {
        console.error(
          `FATAL: Could not generate embedding for ${def.id}. Is the embedding service running?`,
        );
        process.exit(1);
      }
      embedding = result;
    }

    // Upsert
    await db
      .insert(entityDirectory)
      .values({
        id: def.id,
        type: "agent",
        name: def.name,
        description: def.description,
        capabilities,
        capabilities_embedding: capsChanged ? embedding : undefined,
        status: "active",
        metadata: {},
        last_seeded_at: new Date(),
      })
      .onConflictDoUpdate({
        target: entityDirectory.id,
        set: {
          name: def.name,
          description: def.description,
          capabilities,
          ...(capsChanged && embedding
            ? { capabilities_embedding: embedding }
            : {}),
          status: "active",
          last_seeded_at: new Date(),
          updated_at: new Date(),
        },
      });

    console.log(
      `  ${capsChanged ? "UPDATED" : "UNCHANGED"}: ${def.id} (${capabilities.length} capabilities)`,
    );
    seededIds.push(def.id);
  }

  // Deactivate stale agent entries
  let deactivatedCount = 0;
  if (seededIds.length > 0) {
    const result = await db
      .update(entityDirectory)
      .set({ status: "inactive", updated_at: new Date() })
      .where(
        and(
          eq(entityDirectory.type, "agent"),
          eq(entityDirectory.status, "active"),
          notInArray(entityDirectory.id, seededIds),
        ),
      )
      .returning({ id: entityDirectory.id });
    deactivatedCount = result.length;
    if (deactivatedCount > 0) {
      for (const row of result) {
        console.log(`  DEACTIVATED: ${row.id}`);
      }
    }
  }

  console.log(
    `\nSeeded ${withCaps.length} entities, deactivated ${deactivatedCount} stale entries`,
  );

  await client.end();
}

main().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});

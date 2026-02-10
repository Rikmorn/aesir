/**
 * Agents Environment Configuration
 *
 * Validates environment variables at module load time (fail-fast).
 * Importing this module triggers validation - env errors exit immediately.
 *
 * Design decisions:
 * - dotenv-flow loads .env (and .env.local if present)
 * - Zod schema validates all required variables
 * - Validation runs at import time (not lazy)
 * - Process exits with error message if validation fails
 */

import dotenvFlow from "dotenv-flow";
import { z } from "zod";

// Load env files immediately
dotenvFlow.config({ silent: true, default_node_env: "development" });

/**
 * Agents environment schema
 * All env vars needed by the unified agent service
 */
const agentEnvSchema = z.object({
  // Environment
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  // Anthropic (required)
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),

  // Workspace configuration (passed to MCP calls)
  LINEAR_TEAM_ID: z.string().min(1, "LINEAR_TEAM_ID is required"),
  GITHUB_REPO: z.string().min(1, "GITHUB_REPO is required"),
  SLACK_CHANNEL_ID: z.string().min(1, "SLACK_CHANNEL_ID is required"),
  SLACK_TEAM_ID: z.string().optional(),
  DEV_AGENT_NOTIFY_CHANNEL: z.string().optional(),
  PRODUCT_AGENT_NOTIFY_CHANNEL: z.string().optional(),

  // MCP service URLs (Docker network defaults)
  LINEAR_MCP_URL: z.string().url().optional(),
  GITHUB_MCP_URL: z.string().url().optional(),
  SLACK_MCP_URL: z.string().url().optional(),

  // Database (using DB_* to match existing, with DATABASE_* as alternatives)
  DB_HOST: z.string().default("localhost"),
  DB_PORT: z.coerce.number().default(5432),
  DB_USER: z.string().default("aesir"),
  DB_PASSWORD: z.string().default("aesir"),
  DB_NAME: z.string().default("aesir"),
  CREDENTIAL_ENCRYPTION_KEY: z.string().length(64).optional(),

  // Observability
  LANGSMITH_TRACING: z
    .string()
    .transform((v) => v === "true")
    .default("false"),
  LANGSMITH_API_KEY: z.string().optional(),
  LANGSMITH_PROJECT: z.string().default("aesir-agents"),

  // Retention
  RETENTION_DAYS: z.coerce.number().int().positive().default(14),

  // Agent Service
  AGENT_SERVICE_PORT: z.coerce.number().default(3004),
  MAX_CONCURRENT_CONVERSATIONS: z.coerce.number().int().positive().default(5),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  FORCE_SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),

  // Router config (moved from router service)
  ROUTER_ALERTS_CHANNEL: z.string().optional(),

  // GitHub config (for DevContainerManager)
  GITHUB_REPO_URL: z.string().optional(),
  GITHUB_TOKEN: z.string().optional(),
  GITHUB_OWNER: z.string().optional(),
  GITHUB_BASE_BRANCH: z.string().default("main"),

  // Dev agent config
  DEV_AGENT_SLACK_CHANNEL: z.string().optional(),

  // Product agent config
  PRODUCT_AGENT_ALLOWED_CHANNELS: z.string().optional(),

  // Embedding provider (optional -- only required when knowledge tools are used)
  EMBEDDING_PROVIDER: z.enum(["ollama", "voyage"]).default("ollama"),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(768),
  OLLAMA_URL: z.string().url().optional(),
  OLLAMA_MODEL: z.string().default("nomic-embed-text"),
  VOYAGE_API_KEY: z.string().optional(),
  VOYAGE_MODEL: z.string().default("voyage-3.5"),
});

// Validate immediately (fail-fast)
const result = agentEnvSchema.safeParse(process.env);
if (!result.success) {
  // biome-ignore lint/suspicious/noConsole: Intentional - pre-logger startup error reporting
  console.error("\n[X] Agents environment validation failed:\n");
  const fieldErrors = result.error.flatten().fieldErrors;
  for (const [field, errors] of Object.entries(fieldErrors)) {
    if (errors && errors.length > 0) {
      // biome-ignore lint/suspicious/noConsole: Intentional - pre-logger startup error reporting
      console.error(`  - ${field}: ${errors.join(", ")}`);
    }
  }
  // biome-ignore lint/suspicious/noConsole: Intentional - pre-logger startup error reporting
  console.error("\nCheck your .env files or environment variables.\n");
  process.exit(1);
}

export const env = result.data;

export const config = {
  nodeEnv: env.NODE_ENV,
  isProduction: env.NODE_ENV === "production",
  isDevelopment: env.NODE_ENV === "development",
  isTest: env.NODE_ENV === "test",

  anthropic: { apiKey: env.ANTHROPIC_API_KEY },

  // Workspace configuration (passed to MCP calls)
  linear: {
    teamId: env.LINEAR_TEAM_ID,
  },
  github: {
    repo: env.GITHUB_REPO,
    repoUrl: env.GITHUB_REPO_URL,
    token: env.GITHUB_TOKEN,
    owner: env.GITHUB_OWNER,
    baseBranch: env.GITHUB_BASE_BRANCH,
  },
  slack: {
    channelId: env.SLACK_CHANNEL_ID,
    teamId: env.SLACK_TEAM_ID,
  },
  notify: {
    devAgent: env.DEV_AGENT_NOTIFY_CHANNEL || env.SLACK_CHANNEL_ID,
    productAgent: env.PRODUCT_AGENT_NOTIFY_CHANNEL || env.SLACK_CHANNEL_ID,
  },

  // MCP service URLs (Docker network defaults)
  mcp: {
    linear: {
      url: env.LINEAR_MCP_URL || "http://linear-integration:3001",
    },
    github: {
      url: env.GITHUB_MCP_URL || "http://github-integration:3002",
    },
    slack: {
      url: env.SLACK_MCP_URL || "http://slack-integration:3003",
    },
  },

  database: {
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    name: env.DB_NAME,
    url: `postgresql://${env.DB_USER}:${env.DB_PASSWORD}@${env.DB_HOST}:${env.DB_PORT}/${env.DB_NAME}`,
    encryptionKey: env.CREDENTIAL_ENCRYPTION_KEY,
  },

  service: {
    port: env.AGENT_SERVICE_PORT,
    maxConcurrentConversations: env.MAX_CONCURRENT_CONVERSATIONS,
    workerPollIntervalMs: env.WORKER_POLL_INTERVAL_MS,
    forceShutdownTimeoutMs: env.FORCE_SHUTDOWN_TIMEOUT_MS,
  },

  router: {
    alertsChannel: env.ROUTER_ALERTS_CHANNEL,
  },

  embedding: {
    provider: env.EMBEDDING_PROVIDER,
    dimensions: env.EMBEDDING_DIMENSIONS,
    ollama: {
      url: env.OLLAMA_URL || "http://ollama:11434",
      model: env.OLLAMA_MODEL,
    },
    voyage: {
      apiKey: env.VOYAGE_API_KEY,
      model: env.VOYAGE_MODEL,
    },
  },

  observability: {
    langsmith: {
      tracing: env.LANGSMITH_TRACING,
      apiKey: env.LANGSMITH_API_KEY,
      project: env.LANGSMITH_PROJECT,
    },
  },
  logging: { level: env.LOG_LEVEL },
  retention: { days: env.RETENTION_DAYS },
} as const;

export type AgentEnv = z.infer<typeof agentEnvSchema>;
export type AgentsConfig = typeof config;

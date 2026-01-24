/**
 * Agents Environment Configuration
 *
 * Validates environment variables at module load time (fail-fast).
 * Importing this module triggers validation - env errors exit immediately.
 *
 * Design decisions:
 * - dotenv-flow loads .env files in order: .env.local > .env.{NODE_ENV} > .env
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
 * All env vars needed by dev-agent and product-agent
 */
const agentEnvSchema = z.object({
  // Environment
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  // Anthropic (required)
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),

  // Slack (required for agents)
  SLACK_BOT_TOKEN: z.string().min(1, "SLACK_BOT_TOKEN is required"),
  SLACK_APP_TOKEN: z.string().min(1, "SLACK_APP_TOKEN is required"),
  SLACK_CHANNEL_ID: z.string().min(1, "SLACK_CHANNEL_ID is required"),

  // Linear (required for agents)
  LINEAR_ACCESS_TOKEN: z.string().min(1, "LINEAR_ACCESS_TOKEN is required"),
  LINEAR_TEAM_ID: z.string().min(1, "LINEAR_TEAM_ID is required"),
  LINEAR_CLIENT_ID: z.string().optional(),
  LINEAR_CLIENT_SECRET: z.string().optional(),
  LINEAR_WEBHOOK_SECRET: z.string().optional(),
  OAUTH_CALLBACK_URL: z.string().optional(),

  // GitHub (required for agents)
  GITHUB_TOKEN: z.string().min(1, "GITHUB_TOKEN is required"),
  GITHUB_REPO: z.string().min(1, "GITHUB_REPO is required"),

  // Database (using DB_* to match existing, with DATABASE_* as alternatives)
  DB_HOST: z.string().default("localhost"),
  DB_PORT: z.coerce.number().default(5432),
  DB_USER: z.string().default("temporal"),
  DB_PASSWORD: z.string().default("temporal"),
  DB_NAME: z.string().default("temporal"),
  CREDENTIAL_ENCRYPTION_KEY: z.string().length(64).optional(),

  // Temporal
  TEMPORAL_ADDRESS: z.string().default("localhost:7233"),
  TEMPORAL_NAMESPACE: z.string().default("default"),

  // Observability
  LANGSMITH_TRACING: z
    .string()
    .transform((v) => v === "true")
    .default("false"),
  LANGSMITH_API_KEY: z.string().optional(),
  LANGSMITH_PROJECT: z.string().default("aesir-agents"),

  // Retention
  RETENTION_DAYS: z.coerce.number().int().positive().default(14),
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
  slack: {
    botToken: env.SLACK_BOT_TOKEN,
    appToken: env.SLACK_APP_TOKEN,
    channelId: env.SLACK_CHANNEL_ID,
  },
  linear: {
    accessToken: env.LINEAR_ACCESS_TOKEN,
    teamId: env.LINEAR_TEAM_ID,
    clientId: env.LINEAR_CLIENT_ID,
    clientSecret: env.LINEAR_CLIENT_SECRET,
    webhookSecret: env.LINEAR_WEBHOOK_SECRET,
    oauthCallbackUrl: env.OAUTH_CALLBACK_URL,
  },
  github: {
    token: env.GITHUB_TOKEN,
    repo: env.GITHUB_REPO,
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
  temporal: {
    address: env.TEMPORAL_ADDRESS,
    namespace: env.TEMPORAL_NAMESPACE,
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

/**
 * Environment Configuration Module
 *
 * Provides type-safe environment configuration using dotenv-flow for
 * environment-specific file loading and Zod for validation.
 *
 * This module MUST be imported before any code that accesses process.env.
 *
 * Features:
 * - NODE_ENV-based file hierarchy (.env, .env.development, .env.local, etc.)
 * - Fail-fast validation at startup (lists ALL missing vars at once)
 * - Type-safe config object with nested structure
 */

import dotenvFlow from "dotenv-flow";
import { z } from "zod";

// Load env files based on NODE_ENV
// Priority (lowest to highest):
// 1. .env
// 2. .env.local (skipped in test)
// 3. .env.{NODE_ENV}
// 4. .env.{NODE_ENV}.local
// 5. Already-set environment variables
dotenvFlow.config({
  default_node_env: "development",
  silent: true,
});

/**
 * Environment variable schema
 *
 * Required secrets use .min(1) for presence validation only.
 * Per CONTEXT.md: "Secrets validation: Presence only - don't validate format patterns"
 */
const envSchema = z.object({
  // Environment
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  // Anthropic (required)
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),

  // Slack (required)
  SLACK_BOT_TOKEN: z.string().min(1, "SLACK_BOT_TOKEN is required"),
  SLACK_APP_TOKEN: z.string().min(1, "SLACK_APP_TOKEN is required"),
  SLACK_CHANNEL_ID: z.string().min(1, "SLACK_CHANNEL_ID is required"),

  // Linear (required)
  LINEAR_ACCESS_TOKEN: z.string().min(1, "LINEAR_ACCESS_TOKEN is required"),
  LINEAR_TEAM_ID: z.string().min(1, "LINEAR_TEAM_ID is required"),
  // Linear OAuth (optional - for app identity)
  LINEAR_CLIENT_ID: z.string().optional(),
  LINEAR_CLIENT_SECRET: z.string().optional(),
  LINEAR_WEBHOOK_SECRET: z.string().optional(),
  OAUTH_CALLBACK_URL: z.string().optional(),

  // GitHub (required)
  GITHUB_TOKEN: z.string().min(1, "GITHUB_TOKEN is required"),
  GITHUB_REPO: z.string().min(1, "GITHUB_REPO is required"),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),

  // Database (optional with default)
  DATABASE_URL: z
    .string()
    .url()
    .default("postgresql://temporal:temporal@localhost:5432/temporal"),

  // Temporal (optional with defaults)
  TEMPORAL_ADDRESS: z.string().default("localhost:7233"),
  TEMPORAL_NAMESPACE: z.string().default("default"),

  // Observability - LangSmith (optional)
  LANGSMITH_TRACING: z
    .string()
    .transform((v) => v === "true")
    .default("false"),
  LANGSMITH_API_KEY: z.string().optional(),
  LANGSMITH_PROJECT: z.string().default("aesir-agents"),

  // Cloudflare Tunnel (optional)
  CLOUDFLARE_TUNNEL_TOKEN: z.string().optional(),
});

// Parse and validate environment
const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const fieldErrors = parsed.error.flatten().fieldErrors;
  for (const [_field, errors] of Object.entries(fieldErrors)) {
    if (errors && errors.length > 0) {
    }
  }
  process.exit(1);
}

/**
 * Validated environment variables
 * Use this for direct access to env vars with type safety
 */
export const env = parsed.data;

/**
 * Typed configuration object
 * Provides nested structure for organized access to configuration
 */
export const config = {
  nodeEnv: env.NODE_ENV,
  isProduction: env.NODE_ENV === "production",
  isDevelopment: env.NODE_ENV === "development",
  isTest: env.NODE_ENV === "test",

  anthropic: {
    apiKey: env.ANTHROPIC_API_KEY,
  },

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
    webhookSecret: env.GITHUB_WEBHOOK_SECRET,
  },

  database: {
    url: env.DATABASE_URL,
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

  logging: {
    level: env.LOG_LEVEL,
  },

  cloudflare: {
    tunnelToken: env.CLOUDFLARE_TUNNEL_TOKEN,
  },
} as const;

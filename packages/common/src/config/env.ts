/**
 * Environment Configuration Module
 *
 * Provides type-safe environment configuration using dotenv-flow for
 * environment-specific file loading and Zod for validation.
 *
 * IMPORTANT: Validation is LAZY - it only runs when `env` or `config` is first accessed.
 * This allows other modules to import from @aesir/common without requiring all env vars.
 *
 * Features:
 * - NODE_ENV-based file hierarchy (.env, .env.development, .env.local, etc.)
 * - Fail-fast validation on first access (lists ALL missing vars at once)
 * - Type-safe config object with nested structure
 */

import dotenvFlow from "dotenv-flow";
import { z } from "zod";

// Flag to track if dotenv has been loaded
let dotenvLoaded = false;

function loadDotenv() {
  if (dotenvLoaded) return;
  dotenvLoaded = true;

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
}

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

  // Database connection (separate components for secret injection)
  DB_HOST: z.string().default("localhost"),
  DB_PORT: z.coerce.number().default(5432),
  DB_USER: z.string().default("temporal"),
  DB_PASSWORD: z.string().default("temporal"),
  DB_NAME: z.string().default("temporal"),

  // Credential encryption (32-byte hex key for AES-256)
  // Generate with: openssl rand -hex 32
  CREDENTIAL_ENCRYPTION_KEY: z
    .string()
    .length(64, "CREDENTIAL_ENCRYPTION_KEY must be 64 hex chars (32 bytes)")
    .optional(),

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

  // Observability retention (optional with default)
  RETENTION_DAYS: z.coerce.number().int().positive().optional().default(14),
});

// Lazy-loaded validated environment
let _env: z.infer<typeof envSchema> | null = null;

function getEnv(): z.infer<typeof envSchema> {
  if (_env) return _env;

  // Load dotenv files first
  loadDotenv();

  // Parse and validate environment
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    // biome-ignore lint/suspicious/noConsole: Intentional startup error output to user
    console.error("\n❌ Environment validation failed:\n");
    const fieldErrors = parsed.error.flatten().fieldErrors;
    for (const [field, errors] of Object.entries(fieldErrors)) {
      if (errors && errors.length > 0) {
        // biome-ignore lint/suspicious/noConsole: Intentional startup error output to user
        console.error(`  • ${field}: ${errors.join(", ")}`);
      }
    }
    // biome-ignore lint/suspicious/noConsole: Intentional startup error output to user
    console.error("\nCheck your .env files or environment variables.\n");
    process.exit(1);
  }

  _env = parsed.data;
  return _env;
}

/**
 * Validated environment variables
 * Use this for direct access to env vars with type safety
 *
 * NOTE: Accessing this triggers validation. Only use in code paths
 * that actually need the full agent environment.
 */
export const env = new Proxy({} as z.infer<typeof envSchema>, {
  get(_target, prop: string) {
    return getEnv()[prop as keyof z.infer<typeof envSchema>];
  },
});

/**
 * Typed configuration object
 * Provides nested structure for organized access to configuration
 *
 * NOTE: Accessing this triggers validation. Only use in code paths
 * that actually need the full agent environment.
 */
export const config = new Proxy({} as ReturnType<typeof buildConfig>, {
  get(_target, prop: string) {
    const e = getEnv();
    const c = buildConfig(e);
    return c[prop as keyof typeof c];
  },
});

function buildConfig(e: z.infer<typeof envSchema>) {
  return {
    nodeEnv: e.NODE_ENV,
    isProduction: e.NODE_ENV === "production",
    isDevelopment: e.NODE_ENV === "development",
    isTest: e.NODE_ENV === "test",

    anthropic: {
      apiKey: e.ANTHROPIC_API_KEY,
    },

    slack: {
      botToken: e.SLACK_BOT_TOKEN,
      appToken: e.SLACK_APP_TOKEN,
      channelId: e.SLACK_CHANNEL_ID,
    },

    linear: {
      accessToken: e.LINEAR_ACCESS_TOKEN,
      teamId: e.LINEAR_TEAM_ID,
      clientId: e.LINEAR_CLIENT_ID,
      clientSecret: e.LINEAR_CLIENT_SECRET,
      webhookSecret: e.LINEAR_WEBHOOK_SECRET,
      oauthCallbackUrl: e.OAUTH_CALLBACK_URL,
    },

    github: {
      token: e.GITHUB_TOKEN,
      repo: e.GITHUB_REPO,
      webhookSecret: e.GITHUB_WEBHOOK_SECRET,
    },

    database: {
      host: e.DB_HOST,
      port: e.DB_PORT,
      user: e.DB_USER,
      password: e.DB_PASSWORD,
      name: e.DB_NAME,
      // Computed URL for backward compatibility
      url: `postgresql://${e.DB_USER}:${e.DB_PASSWORD}@${e.DB_HOST}:${e.DB_PORT}/${e.DB_NAME}`,
      encryptionKey: e.CREDENTIAL_ENCRYPTION_KEY,
    },

    temporal: {
      address: e.TEMPORAL_ADDRESS,
      namespace: e.TEMPORAL_NAMESPACE,
    },

    observability: {
      langsmith: {
        tracing: e.LANGSMITH_TRACING,
        apiKey: e.LANGSMITH_API_KEY,
        project: e.LANGSMITH_PROJECT,
      },
    },

    logging: {
      level: e.LOG_LEVEL,
    },

    cloudflare: {
      tunnelToken: e.CLOUDFLARE_TUNNEL_TOKEN,
    },

    retention: {
      days: e.RETENTION_DAYS,
    },
  } as const;
}

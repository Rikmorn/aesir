/**
 * Linear Integration Configuration
 *
 * Provides type-safe environment configuration for the Linear integration.
 *
 * IMPORTANT: Validation is LAZY - it only runs when `env` or `config` is first accessed.
 * This allows importing from @aesir/integration-linear without requiring Linear env vars.
 */

import dotenvFlow from "dotenv-flow";
import { z } from "zod";

// Flag to track if dotenv has been loaded
let dotenvLoaded = false;

function loadDotenv() {
  if (dotenvLoaded) return;
  dotenvLoaded = true;
  dotenvFlow.config({ silent: true });
}

/**
 * Linear integration environment schema
 * Self-contained validation for Linear-specific environment variables
 */
export const linearEnvSchema = z.object({
  // Server
  PORT: z.coerce.number().default(3001),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  // Linear OAuth
  LINEAR_CLIENT_ID: z.string().min(1, "LINEAR_CLIENT_ID is required"),
  LINEAR_CLIENT_SECRET: z.string().min(1, "LINEAR_CLIENT_SECRET is required"),
  LINEAR_WEBHOOK_SECRET: z.string().min(1, "LINEAR_WEBHOOK_SECRET is required"),
  OAUTH_CALLBACK_URL: z.string().url().optional(),

  // Database
  DB_HOST: z.string().default("localhost"),
  DB_PORT: z.coerce.number().default(5432),
  DB_USER: z.string().default("temporal"),
  DB_PASSWORD: z.string().default("temporal"),
  DB_NAME: z.string().default("temporal"),
  CREDENTIAL_ENCRYPTION_KEY: z.string().length(64).optional(),
});

export type LinearEnv = z.infer<typeof linearEnvSchema>;

// Lazy-loaded validated environment
let _env: LinearEnv | null = null;

function getEnv(): LinearEnv {
  if (_env) return _env;

  loadDotenv();

  const parsed = linearEnvSchema.safeParse(process.env);

  if (!parsed.success) {
    // biome-ignore lint/suspicious/noConsole: Intentional startup error output
    console.error("\n❌ Linear integration environment validation failed:\n");
    const fieldErrors = parsed.error.flatten().fieldErrors;
    for (const [field, errors] of Object.entries(fieldErrors)) {
      if (errors && errors.length > 0) {
        // biome-ignore lint/suspicious/noConsole: Intentional startup error output
        console.error(`  • ${field}: ${errors.join(", ")}`);
      }
    }
    // biome-ignore lint/suspicious/noConsole: Intentional startup error output
    console.error("\nCheck your .env files or environment variables.\n");
    process.exit(1);
  }

  _env = parsed.data;
  return _env;
}

/**
 * Raw environment variables (lazily parsed)
 * Validation only runs when this is first accessed.
 */
export const env = new Proxy({} as LinearEnv, {
  get(_target, prop: string) {
    return getEnv()[prop as keyof LinearEnv];
  },
});

// Build config object from environment
function buildConfig(e: LinearEnv) {
  return {
    server: {
      port: e.PORT,
      nodeEnv: e.NODE_ENV,
    },
    linear: {
      clientId: e.LINEAR_CLIENT_ID,
      clientSecret: e.LINEAR_CLIENT_SECRET,
      webhookSecret: e.LINEAR_WEBHOOK_SECRET,
      oauthCallbackUrl: e.OAUTH_CALLBACK_URL,
    },
    database: {
      host: e.DB_HOST,
      port: e.DB_PORT,
      user: e.DB_USER,
      password: e.DB_PASSWORD,
      name: e.DB_NAME,
      encryptionKey: e.CREDENTIAL_ENCRYPTION_KEY,
    },
    logging: {
      level: e.LOG_LEVEL,
    },
  } as const;
}

/**
 * Typed nested config object (lazily built)
 * Validation only runs when this is first accessed.
 */
export const config = new Proxy({} as ReturnType<typeof buildConfig>, {
  get(_target, prop: string) {
    const e = getEnv();
    const c = buildConfig(e);
    return c[prop as keyof typeof c];
  },
});

export type LinearConfig = ReturnType<typeof buildConfig>;

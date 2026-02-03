import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./src/db/migrations",
  // Use drizzle-specific schema without external dependencies
  // that drizzle-kit's CJS bundler cannot resolve
  schema: "./src/db/schema.drizzle.ts",
  dialect: "postgresql",
  dbCredentials: {
    host: process.env.DB_HOST ?? "localhost",
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER ?? "aesir",
    password: process.env.DB_PASSWORD ?? "aesir",
    database: process.env.DB_NAME ?? "aesir",
    ssl: false,
  },
  migrations: {
    table: "__drizzle_platform_migrations",
    schema: "platform",
  },
  schemaFilter: ["platform"],
});

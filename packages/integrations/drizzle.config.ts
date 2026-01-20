import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./src/db/migrations",
  schema: "./src/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    host: process.env.DB_HOST ?? "localhost",
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER ?? "temporal",
    password: process.env.DB_PASSWORD ?? "temporal",
    database: process.env.DB_NAME ?? "temporal",
  },
  migrations: {
    table: "__drizzle_integrations_migrations",
    schema: "integrations",
  },
  schemaFilter: ["integrations"],
});

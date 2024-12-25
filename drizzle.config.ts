import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
}

export default defineConfig({
  out: "./migrations",
  schema: "./db/schema.ts",
  verbose: true,
  strict: true,
  dialect: "postgresql",
  dbCredentials: {
    host: process.env.PGHOST || "",
    port: Number(process.env.PGPORT) || 5432,
    user: process.env.PGUSER || "",
    password: process.env.PGPASSWORD || "",
    database: process.env.PGDATABASE || "",
  },
});
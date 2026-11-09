import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * OLYMPUS: PRISMA 7 CONFIGURATION
 * Optimized for PostgreSQL (Production)
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "npx tsx ./prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
